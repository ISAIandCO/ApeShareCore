import test from "node:test";
import assert from "node:assert/strict";
import { createAiConversation } from "../src/ai/conversation.js";
import { normalizeAiAttachment } from "../src/ai/chat.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const state = { id: "a", chat: { draft: "Question", messages: [] }, saved: [], sends: 0 };
  const controller = createAiConversation({
    read: () => state.chat, write: chat => { state.chat = chat; }, scope: () => state.id,
    request: () => ({ conversation: [...state.chat.messages, { role: "user", content: state.chat.draft }] }),
    preview: async () => ({ preview: { hash: "reviewed" } }),
    complete: async message => { state.sends++; assert.equal(message.previewHash, "reviewed"); return { content: "Answer" }; },
    persist: async (chat, id) => { state.saved.push({ chat, id }); }, ...overrides,
  });
  return { state, controller };
}

test("AI requires a current reviewed payload and explicit confirmation", async () => {
  const { state, controller } = fixture();
  assert.equal(await controller.send({ confirmed: true }), false);
  await controller.preview();
  await assert.rejects(controller.send(), /confirmation/);
  controller.invalidate();
  assert.equal(await controller.send({ confirmed: true }), false);
  await controller.preview(); await controller.send({ confirmed: true });
  assert.equal(state.sends, 1);
  assert.deepEqual(state.chat.messages.map(message => message.content), ["Question", "Answer"]);
  assert.equal(state.chat.draft, "");
});

test("AI discards out of order previews and edits invalidate in-flight previews", async () => {
  const pending = [deferred(), deferred(), deferred()]; let index = 0;
  const { controller } = fixture({ preview: () => pending[index++].promise });
  const first = controller.preview(), second = controller.preview();
  await Promise.resolve();
  pending[1].resolve({ preview: { hash: "new" } }); await second;
  pending[0].resolve({ preview: { hash: "old" } }); assert.equal(await first, null);
  assert.equal(controller.reviewed.preview.hash, "new");
  const third = controller.preview(); controller.invalidate();
  pending[2].resolve({ preview: { hash: "stale" } });
  assert.equal(await third, null); assert.equal(controller.reviewed, null);
});

test("AI serializes sends per scope and preserves a new scope's preview when the old answer arrives", async () => {
  const reply = deferred();
  const { state, controller } = fixture({ complete: () => reply.promise });
  await controller.preview(); const sending = controller.send({ confirmed: true });
  assert.equal(controller.busy, true);
  assert.equal(await controller.send({ confirmed: true }), false);
  state.id = "b"; state.chat = { draft: "Other", messages: [] };
  await controller.preview();
  reply.resolve({ content: "Answer for a" }); await sending;
  assert.equal(state.saved[0].id, "a");
  assert.equal(state.saved[0].chat.messages.at(-1).content, "Answer for a");
  assert.equal(state.chat.draft, "Other");
  assert.ok(controller.reviewed); assert.equal(controller.busy, false);
});

test("AI failures release the send lock without clearing unsent text", async () => {
  const { state, controller } = fixture({ complete: async () => { throw new Error("offline"); } });
  await controller.preview(); await assert.rejects(controller.send({ confirmed: true }), /offline/);
  assert.equal(controller.busy, false); assert.equal(state.chat.draft, "Question");
  assert.equal(state.saved.length, 0); assert.equal(controller.reviewed, null);
});

test("unmounted AI persists the original answer without touching the destroyed surface", async () => {
  const reply = deferred(); let writes = 0;
  const { state, controller } = fixture({ complete: () => reply.promise, write: () => writes++ });
  await controller.preview(); const sending = controller.send({ confirmed: true }); controller.destroy();
  reply.resolve({ content: "Answer" }); await sending;
  assert.equal(writes, 0); assert.equal(state.saved.length, 1);
  assert.equal(await controller.preview(), null);
});

test("AI evidence keeps large text independently of workspace display limits and strips secret fields", () => {
  const item = normalizeAiAttachment({ type: "event", value: "1", snapshot: { Message: "x".repeat(300_000), apiToken: "secret" } });
  assert.equal(item.snapshot.Message.length, 300_000); assert.equal(item.snapshot.apiToken, undefined);
});

test("failed persistence leaves the original draft available for recovery", async () => {
  const { state, controller } = fixture({ persist: async () => { throw new Error("storage full"); } });
  await controller.preview(); await assert.rejects(controller.send({ confirmed: true }), /storage full/);
  assert.equal(state.chat.draft, "Question"); assert.equal(controller.busy, false);
});
