const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVersion, withExpectedVersion, isConflictResponse } = require('../js/sync-version.js');

test('normalizes server versions', () => {
  assert.equal(normalizeVersion('12'), 12);
  assert.equal(normalizeVersion(-1), null);
  assert.equal(normalizeVersion('abc'), null);
});

test('adds expected version without mutating payload', () => {
  const payload = { action:'add' };
  const versioned = withExpectedVersion(payload, 4);
  assert.deepEqual(versioned, { action:'add', expectedVersion:4 });
  assert.deepEqual(payload, { action:'add' });
});

test('detects both supported conflict response forms', () => {
  assert.equal(isConflictResponse({ conflict:true }), true);
  assert.equal(isConflictResponse({ code:'VERSION_CONFLICT' }), true);
  assert.equal(isConflictResponse({ ok:false }), false);
});
