import test from 'node:test';
import assert from 'node:assert/strict';
import { operationContext, matchesOperation, groupOperations, createOperationStore } from '../src/graph/operations.js';
import { migrateOperationProfiles, normalizeOperationProfiles } from '../src/settings/operation-profiles.js';
import { searchOperationPage } from '../src/graph/operation-search.js';
const process = { nodeId: 'original', host: 'host.example', pid: '42', time: 100, from: 100, to: 1000, platform: 'windows' };
const fact = id => ({ id: String(id), host: process.host, pid: '0x2a', time: 150, objectKey: '/test/file', label: 'file', raw: { id } });
const profile = { id: 'test', name: 'test', category: 'files', platform: 'windows', enabled: true, sourceField: 'source', sourceValues: 'test', eventField: 'event', eventValues: '11', host: 'host', pid: 'pid', target: 'file', recordId: 'id', time: 'time' };
test('identity is host + lifetime, GUID wins, PID formats normalize', () => {
  const context = operationContext(process, { from: 0, to: 1000 }, [{ ...process, time: 200 }, { ...process, host: 'other', time: 110 }]);
  assert.equal(context.from, 100); assert.equal(context.to, 199);
  assert.ok(matchesOperation(fact(1), context));
  assert.equal(matchesOperation({ ...fact(1), host: 'other' }, context), false);
  assert.equal(matchesOperation({ ...fact(1), time: 99 }, context), false);
  assert.equal(matchesOperation({ ...fact(1), time: 200 }, context), false);
  const guid = operationContext({ ...process, guid: '{ABC}' }, { from: 0, to: 1000 });
  assert.ok(matchesOperation({ ...fact(1), guid: '{abc}', pid: 999 }, guid));
  assert.equal(matchesOperation({ ...fact(1), guid: 'other' }, guid), false);
  assert.throws(() => operationContext({ ...process, host: '' }, { from: 0, to: 1000 }));
});
test('categories have independent 25-event cursors, group repeated objects without duplicate events', async () => {
  const calls = [];
  const store = createOperationStore(async input => {
    calls.push(input);
    const start = input.cursor ?? 0;
    return { scanned: 25, facts: Array.from({ length: 25 }, (_, i) => fact(start + i)), more: true, cursor: start + 24 };
  });
  assert.equal(calls.length, 0);
  const files = await store.load(process, 'files');
  await store.load(process, 'network');
  await store.load(process, 'files');
  assert.deepEqual(calls.map(call => [call.category, call.limit, call.cursor]), [['files', 25, null], ['network', 25, null], ['files', 25, 24]]);
  assert.equal(files.facts.length, 49); assert.equal(files.loaded, 50);
  assert.equal(groupOperations(files.facts)[0].events.length, 49);
  assert.equal(store.get(process, 'network').facts.length, 25);
  assert.equal(process.nodeId, 'original');
});
test('repeated clicks are suppressed and stale results discarded', async () => {
  let finish, calls = 0;
  const store = createOperationStore(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const request = store.load(process, 'files');
  await store.load(process, 'files'); assert.equal(calls, 1);
  store.clear(); finish({ scanned: 1, facts: [fact(1)], more: false, cursor: 1 });
  assert.equal(await request, null); assert.equal(store.entries.size, 0);
});
test('empty, unsupported, errors and invalid pages remain distinct; errors can retry', async () => {
  let response = { scanned: 0, facts: [], more: false, cursor: 1 };
  const store = createOperationStore(async () => { if (response instanceof Error) throw response; return response; });
  assert.equal((await store.load(process, 'files')).status, 'empty');
  response = { unsupported: 'No profile' }; assert.equal((await store.load(process, 'dns')).status, 'unsupported');
  response = new Error('HTTP 500'); assert.equal((await store.load(process, 'network')).status, 'error');
  response = { scanned: 1, facts: [fact(1)], more: false, cursor: 1 };
  assert.equal((await store.load(process, 'network')).status, 'ready');
  response = { scanned: 26, facts: [], more: true, cursor: 26 };
  assert.equal((await store.load(process, 'modules')).status, 'error');
});
test('saved profiles and an explicitly empty list survive migration', () => {
  const saved = { version: 1, profiles: [{ ...profile, pid: 'CustomActor', target: 'CustomFile' }] };
  assert.equal(migrateOperationProfiles(saved, [profile]).profiles[0].pid, 'CustomActor');
  assert.equal(migrateOperationProfiles(saved.profiles, [profile]).profiles[0].target, 'CustomFile');
  assert.deepEqual(migrateOperationProfiles([], [profile]).profiles, []);
  assert.equal(migrateOperationProfiles(undefined, [profile]).profiles[0].pid, 'pid');
  assert.throws(() => normalizeOperationProfiles([{ ...profile, pid: 'pid; DROP' }]));
  assert.throws(() => normalizeOperationProfiles([{ ...profile, category: 'registry', platform: 'unix' }]));
});
test('multiple source profiles share a 25-event category budget and reject changed configuration', async () => {
  const calls = [];
  const args = { process, category: 'files', profiles: [profile, { ...profile, id: 'second', pid: 'otherPid' }],
    dialect: { equal: (f,v) => `${f}=${v}`, in: (f,v) => `${f} IN ${v}`, pid: (f,v) => `${f}=${v}`, and: x => x.join(' AND '), factual: 'facts' },
    read: (event, field) => event[field], parseTime: Number,
    fetch: async input => { calls.push(input); return []; } };
  const first = await searchOperationPage(args);
  assert.equal(calls.length, 1); assert.equal(calls[0].limit, 25); assert.ok(first.more);
  const second = await searchOperationPage({ ...args, cursor: first.cursor });
  assert.equal(calls.length, 2); assert.equal(second.more, false); assert.match(calls[1].where, /otherPid=42/);
  await assert.rejects(searchOperationPage({ ...args, profiles: [{ ...profile, pid: 'changed' }], cursor: first.cursor }), /изменились/);
});
test('range expansion does not duplicate categories and explicit category reset ignores an older request', async () => {
  let finish;
  const calls = [];
  const store = createOperationStore(input => { calls.push(input); return new Promise(resolve => { finish = resolve; }); });
  const old = store.load(process, 'files'); const firstFinish = finish;
  const expanded = { ...process, to: 2000 };
  assert.equal(store.get(expanded, 'files'), store.get(process, 'files'));
  store.reset(expanded, 'files');
  const current = store.load(expanded, 'files');
  firstFinish({ scanned: 1, facts: [fact('old')], more: false, cursor: 1 });
  assert.equal(await old, null);
  finish({ scanned: 1, facts: [fact('new')], more: false, cursor: 1 });
  assert.equal((await current).facts[0].id, 'new');
  assert.equal(store.entries.size, 1); assert.equal(calls[1].process.to, 2000);
});
