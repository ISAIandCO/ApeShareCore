import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRecordStorage } from "../src/storage/records.js";
import { createGraphSnapshots } from "../src/graph/snapshots.js";
const input = () => ({ sourceTabId: 4, sourceEvent: { id: "source" }, context: { cluster: "c" }, response: { origin: "https://siem.test", graph: { nodes: [{ id: "source", event: { token: "raw-evidence" } }] } } });
function fixture(options = {}) {
  const factory = new IDBFactory();
  const storage = createRecordStorage({ databaseFactory: () => factory, name: "snapshots" });
  return { storage, snapshots: createGraphSnapshots({ storage, ...options }) };
}
test("snapshots restore raw evidence and source context, update in place, and delete", async () => {
  const { storage, snapshots } = fixture(); const source = input();
  const saved = await snapshots.saveGraphSnapshot(source);
  source.response.graph.nodes.length = 0;
  const restored = await snapshots.getGraphSnapshot(saved.id);
  assert.equal(restored.response.graph.nodes[0].event.token, "raw-evidence");
  assert.deepEqual(restored.context, { cluster: "c" });
  const update = await snapshots.updateGraphSnapshot(saved.id, { response: { ...restored.response, graph: { nodes: [] } } });
  assert.equal(update.createdAt, saved.createdAt);
  assert.equal((await snapshots.getGraphSnapshot(saved.id)).sourceTabId, 4);
  await snapshots.deleteGraphSnapshot(saved.id);
  assert.deepEqual(await storage.get(null), {});
});
test("snapshots reject invalid origins, oversized graphs and corrupted persisted metadata", async () => {
  const { storage, snapshots } = fixture();
  await assert.rejects(snapshots.saveGraphSnapshot({ ...input(), response: { origin: "https://siem.test/path", graph: { nodes: [] } } }), /origin/);
  await assert.rejects(snapshots.saveGraphSnapshot({ ...input(), response: { origin: "https://siem.test", graph: { nodes: Array(10001).fill({}) } } }), /too many/);
  const small = createGraphSnapshots({ storage, maxBytes: 100 });
  await assert.rejects(small.saveGraphSnapshot(input()), /too large/);
  const saved = await snapshots.saveGraphSnapshot(input());
  const key = `graph:${saved.id}`; const record = (await storage.get(key))[key];
  await storage.set({ [key]: { ...record, schemaVersion: 9 } });
  await assert.rejects(snapshots.getGraphSnapshot(saved.id), /stored/);
});
test("parallel snapshot saves retain the configured bound and leave unrelated records alone", async () => {
  const { storage, snapshots } = fixture({ maxSnapshots: 3 });
  await storage.set({ other: { createdAt: 0 } });
  await Promise.all(Array.from({ length: 12 }, () => snapshots.saveGraphSnapshot(input())));
  const stored = await storage.get(null);
  assert.equal(Object.keys(stored).filter(key => key.startsWith("graph:")).length, 3);
  assert.deepEqual(stored.other, { createdAt: 0 });
});
