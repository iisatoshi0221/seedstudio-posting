(function (root) {
  "use strict";

  // ============================================================
  // SeedStudio Posting
  // Posting Records v2 - shared compatibility model
  // SP-Next-2C-1
  //
  // Shared legacy compatibility, multi-flyer validation and totals.
  // Existing activity and monthly metrics keep their original unit.
  // ============================================================

  const STATUS_ACTIVE = "active";
  const STATUS_DELETED = "deleted";
  // DEC-121: 1–8 distinct flyers per activity.
  const MAX_FLYER_SELECTION = 8;
  const FLYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

  function hasOwn(record, key) {
    return !!record &&
      Object.prototype.hasOwnProperty.call(record, key);
  }

  function getStatus(record) {
    return record?.status === STATUS_DELETED
      ? STATUS_DELETED
      : STATUS_ACTIVE;
  }

  function isActive(record) {
    return getStatus(record) === STATUS_ACTIVE;
  }

  function isDeleted(record) {
    return getStatus(record) === STATUS_DELETED;
  }

  function getVersion(record) {
    const value = Number(record?.version);

    return Number.isInteger(value) && value >= 1
      ? value
      : 1;
  }

  function isLegacy(record) {
    return !hasOwn(record, "status") ||
      !hasOwn(record, "version");
  }

  function getCompatibilityMeta(record) {
    return {
      status: getStatus(record),
      version: getVersion(record),
      legacy: isLegacy(record)
    };
  }

  function filterActive(records) {
    return (Array.isArray(records) ? records : [])
      .filter(isActive);
  }

  // P01: Multi-flyer read compatibility and pure validation.
  // Never mutates records, never writes to Firestore.
  function getFlyerIds(record) {
    if (Array.isArray(record?.flyerIds)) {
      return [...record.flyerIds];
    }

    return typeof record?.flyerId === "string" &&
      record.flyerId.length > 0
        ? [record.flyerId]
        : [];
  }

  function normalizeFlyerIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("FLYER_SELECTION_REQUIRED");
    }
    if (ids.length > MAX_FLYER_SELECTION) {
      throw new Error("FLYER_SELECTION_LIMIT_EXCEEDED");
    }
    if (ids.some(id => typeof id !== "string" || !FLYER_ID_PATTERN.test(id))) {
      throw new Error("INVALID_FLYER_ID");
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error("DUPLICATE_FLYER_ID");
    }
    return [...ids];
  }

  function createFlyerSelection(ids) {
    const flyerIds = normalizeFlyerIds(ids);

    return {
      flyerId: flyerIds[0],
      flyerIds
    };
  }

  function isFlyerSelectionConsistent(record) {
    if (!record || typeof record !== "object") {
      return false;
    }

    try {
      const ids = normalizeFlyerIds(getFlyerIds(record));

      return record.flyerId === ids[0] &&
        (
          !hasOwn(record, "flyerIds") ||
          (
            Array.isArray(record.flyerIds) &&
            record.flyerIds.length === ids.length &&
            record.flyerIds.every((id, i) => id === ids[i])
          )
        );
    } catch {
      return false;
    }
  }

  function getTotalFlyerQuantity(record) {
    if (!isFlyerSelectionConsistent(record)) {
      throw new Error("INVALID_FLYER_SELECTION");
    }

    const quantity = record.quantity;

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("INVALID_QUANTITY");
    }

    const total = quantity * getFlyerIds(record).length;
    if (!Number.isSafeInteger(total)) {
      throw new Error("INVALID_QUANTITY");
    }
    return total;
  }


  // P05: Pure multi-flyer aggregation.
  // Existing activity metrics and monthly-report.js are unchanged.
  function aggregateFlyerStats(records, targetYm = null) {
    if (
      targetYm !== null &&
      (
        typeof targetYm !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetYm)
      )
    ) {
      throw new Error("INVALID_TARGET_MONTH");
    }

    const byFlyer = new Map();
    let activityCount = 0;
    let activityQuantity = 0;
    let totalFlyerQuantity = 0;

    for (const record of filterActive(records)) {
      if (
        !record ||
        typeof record.postingDate !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(record.postingDate)
      ) {
        throw new Error("INVALID_POSTING_DATE");
      }

      const [year, month, day] =
        record.postingDate.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));

      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
      ) {
        throw new Error("INVALID_POSTING_DATE");
      }

      if (
        targetYm !== null &&
        record.postingDate.slice(0, 7) !== targetYm
      ) {
        continue;
      }

      if (!isFlyerSelectionConsistent(record)) {
        throw new Error("INVALID_FLYER_SELECTION");
      }

      const quantity = record.quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error("INVALID_QUANTITY");
      }

      const ids = getFlyerIds(record);
      const recordTotal = getTotalFlyerQuantity(record);

      const nextActivityQuantity = activityQuantity + quantity;
      const nextTotalFlyerQuantity =
        totalFlyerQuantity + recordTotal;
      const nextActivityCount = activityCount + 1;

      if (
        !Number.isSafeInteger(nextActivityQuantity) ||
        !Number.isSafeInteger(nextTotalFlyerQuantity) ||
        !Number.isSafeInteger(nextActivityCount)
      ) {
        throw new Error("POSTING_AGGREGATION_OVERFLOW");
      }

      const updates = ids.map(id => ({
        id,
        quantity: (byFlyer.get(id) || 0) + quantity
      }));
      if (
        updates.some(item =>
          !Number.isSafeInteger(item.quantity)
        )
      ) {
        throw new Error("POSTING_AGGREGATION_OVERFLOW");
      }

      activityCount = nextActivityCount;
      activityQuantity = nextActivityQuantity;
      totalFlyerQuantity = nextTotalFlyerQuantity;

      for (const item of updates) {
        byFlyer.set(item.id, item.quantity);
      }
    }

    return {
      activityCount,
      activityQuantity,
      totalFlyerQuantity,
      byFlyer: Object.fromEntries(byFlyer)
    };
  }


  // DEV-025: absent activityType is the historical normal activity.
  function activityType(record) {
    return Object.hasOwn(record || {}, "activityType") ? record.activityType : "normal";
  }
  function parseStaffSteps(value) {
    if (value === null || value === "") return null;
    if (typeof value === "string" && !/^\d+$/.test(value)) throw new Error("INVALID_STAFF_STEPS");
    const steps = typeof value === "string" ? Number(value) : value;
    if (!Number.isSafeInteger(steps) || steps < 0) throw new Error("INVALID_STAFF_STEPS");
    return steps;
  }
  function assertActivity(record) {
    const type = activityType(record);
    if (!["normal", "staffOnly"].includes(type)) throw new Error("INVALID_ACTIVITY_TYPE");
    if (!Array.isArray(record.participants)) throw new Error("INVALID_PARTICIPANTS");
    if (type === "staffOnly") {
      if (record.participants.length || !Object.hasOwn(record, "staffSteps") ||
          !(record.staffSteps === null || (Number.isSafeInteger(record.staffSteps) && record.staffSteps >= 0))) {
        throw new Error("INVALID_STAFF_ACTIVITY");
      }
    } else if (Object.hasOwn(record, "staffSteps") || !record.participants.length ||
        record.participants.some(p => !p || typeof p.participantId !== "string" || !Number.isSafeInteger(p.steps) || p.steps <= 0)) {
      throw new Error("INVALID_PARTICIPANTS");
    }
  }

  const api = Object.freeze({
    activityType, parseStaffSteps, assertActivity,
    STATUS_ACTIVE,
    STATUS_DELETED,
    MAX_FLYER_SELECTION,
    FLYER_ID_PATTERN,
    getStatus,
    isActive,
    isDeleted,
    getVersion,
    isLegacy,
    getCompatibilityMeta,
    filterActive,
    getFlyerIds,
    normalizeFlyerIds,
    createFlyerSelection,
    isFlyerSelectionConsistent,
    getTotalFlyerQuantity,
    aggregateFlyerStats
  });

  root.SeedStudioPostingRecordModel = api;

})(typeof window !== "undefined" ? window : globalThis);
