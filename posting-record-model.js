(function (root) {
  "use strict";

  // ============================================================
  // SeedStudio Posting
  // Posting Records v2 - shared compatibility model
  // SP-Next-2C-1
  //
  // Read compatibility only. Existing Firestore writes stay on
  // the v0.1 schema until v2 transaction + Rules work is added.
  // ============================================================

  const STATUS_ACTIVE = "active";
  const STATUS_DELETED = "deleted";

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

  const api = Object.freeze({
    STATUS_ACTIVE,
    STATUS_DELETED,
    getStatus,
    isActive,
    isDeleted,
    getVersion,
    isLegacy,
    getCompatibilityMeta,
    filterActive
  });

  root.SeedStudioPostingRecordModel = api;

})(typeof window !== "undefined" ? window : globalThis);
