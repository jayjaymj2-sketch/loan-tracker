(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.SyncVersion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function normalizeVersion(value){
    const version = Number(value);
    return Number.isInteger(version) && version >= 0 ? version : null;
  }

  function withExpectedVersion(payload, version){
    const normalized = normalizeVersion(version);
    return normalized == null ? Object.assign({}, payload) : Object.assign({}, payload, { expectedVersion: normalized });
  }

  function isConflictResponse(data){
    return !!(data && (data.conflict === true || data.code === 'VERSION_CONFLICT'));
  }

  return { normalizeVersion, withExpectedVersion, isConflictResponse };
});
