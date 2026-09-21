import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_OPERATION_RECIPES } from '../src/settings/operation-recipes.js';
import { normalizeOperationProfiles, operationFact, migrateOperationProfiles } from '../src/settings/operation-profiles.js';
const defaults = AUDIT_OPERATION_RECIPES.map(recipe => ({ ...recipe, enabled: false, sourceField: 'source', sourceValues: 'audit', eventField: 'type', host: 'host', pid: 'actor', target: 'target', time: 'time', recordId: 'id' }));
const read = (event, field) => event[field];
test('all Windows Security and Linux recipes validate disabled and require actual classifier mapping to enable', () => {
  assert.equal(normalizeOperationProfiles(defaults).length, 9);
  for (const profile of defaults) {
    if (profile.selectorRequired) assert.throws(() => normalizeOperationProfiles([{ ...profile, enabled: true }]), /укажите поле/);
    assert.doesNotThrow(() => normalizeOperationProfiles([{ ...profile, enabled: true, operationField: profile.selectorRequired ? 'classifier' : '' }]));
  }
});
test('4663 files, registry and process accesses remain disjoint and retain access mask', () => {
  const event = { source: 'audit', type: '4663', classifier: 'Process', actor: '0x002a', target: 'target.exe', id: 'synthetic', time: 10, mask: '0x10' };
  for (const id of ['security-files', 'security-registry-access', 'security-access']) {
    const profile = { ...defaults.find(item => item.id === id), operationField: 'classifier', action: 'mask' };
    const fact = operationFact(event, profile, read, Number);
    if (id !== 'security-access') assert.equal(fact, null);
    else { assert.equal(fact.pid, '0x002a'); assert.match(fact.operation, /0x10/); }
  }
});
test('auditd does not classify arbitrary syscalls or targetless records as file/network/module operations', () => {
  for (const profile of defaults.filter(item => item.platform === 'unix')) {
    const configured = { ...profile, operationField: 'syscall', outcome: 'success' };
    const event = { source: 'audit', type: 'SYSCALL', actor: 42, id: 'synthetic', time: 10, syscall: 'execve', target: '/example', success: 'no' };
    assert.equal(operationFact(event, configured, read, Number), null);
    event.syscall = profile.operationValues.split(',')[0].trim();
    const fact = operationFact(event, configured, read, Number);
    assert.match(fact.operation, /no$/);
    assert.equal(operationFact({ ...event, target: '' }, configured, read, Number), null);
    assert.equal(operationFact({ ...event, target: '-' }, configured, read, Number), null);
  }
});
test('registry values form distinct objects and recipe updates preserve saved mappings and deletions', () => {
  const profile = { ...defaults.find(item => item.id === 'security-registry-value'), targetDetail: 'value' };
  const event = { source: 'audit', type: '4657', target: 'HKLM/example', value: 'first', id: '1', time: 10 };
  assert.notEqual(operationFact(event, profile, read, Number).objectKey, operationFact({ ...event, value: 'second' }, profile, read, Number).objectKey);
  const saved = migrateOperationProfiles([{ ...profile, pid: 'customActor' }], defaults);
  assert.equal(saved.profiles.length, 1); assert.equal(migrateOperationProfiles(saved, defaults).profiles[0].pid, 'customActor');
  assert.deepEqual(migrateOperationProfiles([], defaults).profiles, []);
});
