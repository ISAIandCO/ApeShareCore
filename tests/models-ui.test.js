import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspace, addWorkspaceItem, workspaceToJson } from "../src/investigation/model.js";
import { normalizeAiChat, appendAiMessage, addAiAttachment } from "../src/ai/chat.js";
import { buildIocBatchJobs, normalizeIocBatchResult, readIocCache } from "../src/ioc/batch.js";
import { iocActions, mountIocActions } from "../src/ioc/ui.js";

test("investigation model retains existing schema and leaves input untouched", () => {
  const original = createWorkspace({ title: "Case", siemOrigin: "https://example.org" }, 1, "case");
  const first = addWorkspaceItem(original, { type: "event", value: "event", sourceEventUuid: "event", snapshot: { ID: "event", password: "secret" } }, 2);
  const next = addWorkspaceItem(first, { type: "event", value: "event", snapshot: { ID: "event", score: 2 } }, 3);
  assert.equal(original.items.length, 0); assert.equal(first.items[0].snapshot.score, undefined);
  assert.equal(next.items.length, 1); assert.equal(next.items[0].createdAt, 2);
  assert.equal(next.items[0].snapshot.score, 2); assert.equal(next.schemaVersion, 1);
  assert.equal(JSON.parse(workspaceToJson(next)).id, "case");
});
test("chat model preserves messages, drafts, attachments and tool requests", () => {
  const input = { draft: "draft", messages: [{ id: "one", role: "user", content: "question", attachments: [{ type: "event", value: "e", snapshot: { ID: "e" } }] }], pendingToolCalls: [{ id: "call", name: "host", arguments: {} }] };
  const before = structuredClone(input);
  const chat = addAiAttachment(appendAiMessage(input, { id: "two", role: "assistant", content: "answer" }), { type: "note", value: "note" });
  assert.deepEqual(input, before); assert.equal(chat.draft, "draft"); assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[0].attachments[0].snapshot.ID, "e"); assert.equal(chat.pendingToolCalls[0].id, "call");
  assert.equal(normalizeAiChat(chat).pendingAttachments.length, 1);
});
test("batch helpers work without a storage implementation", () => {
  const jobs = buildIocBatchJobs([{ type: "ip", value: "8.8.8.8" }], { example: { types: ["ip"] } }, ["example"]);
  const result = normalizeIocBatchResult(jobs[0], { provider: "Example", verdict: "unknown" }, { checkedAt: 100, ttlMs: 10 });
  assert.equal(readIocCache({ key: result }, "key", 105).verdict, "unknown");
  assert.equal(readIocCache({ key: result }, "key", 111), null);
});
test("UI actions are lazy, typed, reusable and restore buttons after errors", async () => {
  const ioc = { type: "ip", value: "8.8.8.8" };
  assert.equal(iocActions(ioc).length, 4);
  assert.equal(iocActions({ type: "hash", value: "a".repeat(64) }).some(action => action.id === "abuseipdb"), false);
  const controls = []; let calls = 0; let errorSeen;
  const ui = mountIocActions(null, { ioc, lookup: async () => { calls++; throw new Error("test failure"); }, onResult: () => assert.fail("No result"), onError: error => { errorSeen = error.message; }, addButton: (label, run) => {
    const button = { textContent: label, disabled: false }; controls.push({ button, run }); return button;
  } });
  assert.equal(calls, 0);
  const { button, run } = controls[0]; const original = button.textContent;
  await run(button); assert.equal(calls, 1); assert.equal(errorSeen, "test failure");
  assert.equal(button.disabled, false); assert.equal(button.textContent, original);
  ui.destroy(); await run(button); assert.equal(calls, 1);
});
