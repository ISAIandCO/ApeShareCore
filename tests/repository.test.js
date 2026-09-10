import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createInvestigationRepository } from "../src/investigation/repository.js";

function repository() { const factory = new IDBFactory(); return createInvestigationRepository({ databaseFactory: () => factory, name: "test" }); }
test("investigations and chats share a schema, preserve status and delete together", async () => {
  const db = repository();
  const workspace = await db.createInvestigation({ title: "Case", siemOrigin: "https://siem.test" });
  await db.updateWorkspace(workspace.id, { status: "closed", notes: "Evidence" });
  await db.saveWorkspaceAiChat(workspace.id, { draft: "Question", messages: [{ role: "user", content: "Hello" }] });
  assert.equal((await db.getWorkspace(workspace.id)).status, "closed");
  assert.equal((await db.getWorkspaceAiChat(workspace.id)).draft, "Question");
  await db.deleteWorkspace(workspace.id);
  assert.equal(await db.getWorkspace(workspace.id), null);
  const handle = await db.openDatabase();
  const count = handle.transaction("aiChats").objectStore("aiChats").count();
  assert.equal(await new Promise(resolve => { count.onsuccess = () => resolve(count.result); }), 0);
  handle.close();
});
test("simultaneous pins from separate extension pages do not overwrite each other", async () => {
  const factory = new IDBFactory();
  const options = { databaseFactory: () => factory, name: "concurrent" };
  const first = createInvestigationRepository(options), second = createInvestigationRepository(options);
  const workspace = await first.createInvestigation({ title: "Case" });
  const events = Array.from({ length: 8 }, (_, index) => ({ type: "event", value: String(index), snapshot: { ID: index, nested: { value: "kept" } } }));
  await Promise.all(events.map((item, index) => (index % 2 ? first : second).pinWorkspaceItem({ workspaceId: workspace.id, item })));
  const saved = await first.getWorkspace(workspace.id);
  assert.equal(saved.items.length, 8);
  assert.deepEqual(saved.items.map(item => item.value).sort(), events.map(item => item.value));
  await assert.rejects(first.removeWorkspaceItem(workspace.id, 20), /Invalid workspace item index/);
  assert.equal((await first.getWorkspace(workspace.id)).items.length, 8);
  (await first.openDatabase()).close(); (await second.openDatabase()).close();
});

test("record storage keeps raw snapshots and supports batched removal", async () => {
  const { createRecordStorage } = await import("../src/storage/records.js");
  const factory = new IDBFactory();
  const storage = createRecordStorage({ databaseFactory: () => factory, name: "records" });
  await storage.set({ graph: { nested: { token: "synthetic-evidence" } }, second: [1, 2] });
  assert.deepEqual(await storage.get("graph"), { graph: { nested: { token: "synthetic-evidence" } } });
  await storage.remove(["graph", "second"]);
  assert.deepEqual(await storage.get(null), {});
});
