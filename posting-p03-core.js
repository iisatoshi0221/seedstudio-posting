(function (root) {
  "use strict";

  const MAX_FLYER_SELECTION = 8;
  const FLYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

  const BUSINESS_FIELDS = Object.freeze([
    "id", "postingDate", "staffId", "flyerId", "quantity",
    "participants", "area", "createdAt"
  ]);

  function postingError(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertFlyerSelection(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw postingError("INVALID_FLYER_SELECTION");
    }
    const ids = Object.hasOwn(record, "flyerIds")
      ? record.flyerIds
      : [record.flyerId];
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FLYER_SELECTION ||
        typeof record.flyerId !== "string" || !FLYER_ID_PATTERN.test(record.flyerId) ||
        ids.some(id => typeof id !== "string" || !FLYER_ID_PATTERN.test(id)) ||
        new Set(ids).size !== ids.length || ids[0] !== record.flyerId) {
      throw postingError("INVALID_FLYER_SELECTION");
    }
    return ids.slice();
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

  function assertPostingQuantity(record) {
    if (!Number.isSafeInteger(record?.quantity) || record.quantity <= 0) {
      throw postingError("INVALID_QUANTITY");
    }
    const total = record.quantity * assertFlyerSelection(record).length;
    if (!Number.isSafeInteger(total)) throw postingError("INVALID_QUANTITY");
  }

  function auditSnapshot(record) {
    assertFlyerSelection(record);
    return {
      ...(Object.hasOwn(record, "activityType") ? {activityType:record.activityType} : {}),
      ...(Object.hasOwn(record, "staffSteps") ? {staffSteps:record.staffSteps} : {}),
      postingDate: record.postingDate || "",
      staffId: record.staffId || "",
      flyerId: record.flyerId,
      ...(Object.hasOwn(record, "flyerIds")
        ? { flyerIds: record.flyerIds.slice() }
        : {}),
      quantity: Number(record.quantity || 0),
      participants: Array.isArray(record.participants) ? record.participants : [],
      area: record.area || {}
    };
  }

  // Preserve every business field exactly (including array order), but ignore
  // server-maintained metadata when comparing a retry with an existing record.
  function comparable(record) {
    const value = {};
    for (const key of BUSINESS_FIELDS) value[key] = record?.[key];
    if (Object.hasOwn(record || {}, "flyerIds")) value.flyerIds = record.flyerIds;
    for (const key of ["activityType", "staffSteps"]) {
      if (Object.hasOwn(record || {}, key)) value[key] = record[key];
    }
    return value;
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    }
    return value;
  }

  function isSameCreate(existing, requested, actorUid) {
    return existing?.createdByUid === actorUid &&
      JSON.stringify(canonical(comparable(existing))) ===
        JSON.stringify(canonical(comparable(requested)));
  }

  // Transaction adapter: {runTransaction, get(ref), set(ref, payload)}.
  // Reads the document before writing and never overwrites a colliding ID.
  async function createOnce(adapter, ref, payload, actorUid) {
    assertActivity(payload);
    assertPostingQuantity(payload);
    return adapter.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        if (isSameCreate(snap.data(), payload, actorUid)) {
          return { status: "existing", record: snap.data() };
        }
        throw postingError("POSTING_ID_CONFLICT");
      }
      tx.set(ref, payload);
      return { status: "created", record: payload };
    });
  }

  function classifySaveError(error) {
    const code = error?.code || error?.message || "";
    if ([
      "permission-denied", "unauthenticated", "invalid-argument",
      "failed-precondition", "INVALID_FLYER_SELECTION", "INVALID_QUANTITY",
      "POSTING_ID_CONFLICT", "POSTING_VERSION_CONFLICT"
    ].includes(code)) return "blocked";
    if (["unavailable", "deadline-exceeded", "network-request-failed"].includes(code)) {
      return "retryable";
    }
    return "unknown";
  }

  function nextQueueStatus(previous, error) {
    return {
      state: classifySaveError(error) === "retryable" ? "pending" : "blocked",
      reason: error?.code || error?.message || "unknown",
      attempts: (Number.isSafeInteger(previous?.attempts) ? previous.attempts : 0) + 1
    };
  }

  function shouldRetry(status) {
    return !status || status.state === "pending";
  }

  const api = Object.freeze({
    MAX_FLYER_SELECTION, FLYER_ID_PATTERN,
    activityType, parseStaffSteps, assertActivity,
    postingError, assertFlyerSelection, assertPostingQuantity,
    auditSnapshot, comparable, isSameCreate, createOnce,
    classifySaveError, nextQueueStatus, shouldRetry
  });
  root.SeedStudioPostingP03Core = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
