import { appendAiMessage, normalizeAiChat } from "./chat.js";

export function finishAiTurn(chat, userMessage, result) {
  let next = appendAiMessage(chat, userMessage);
  const toolCalls = result.toolCalls ?? [];
  next = appendAiMessage(next, { role: "assistant", content: result.content || `Запрошены дополнительные данные: ${toolCalls.map(call => call.name).join("; ")}`, toolCalls });
  next.draft = "";
  next.pendingAttachments = [];
  next.pendingToolCalls = toolCalls;
  return next;
}

// One state machine for every chat surface; transport, context and persistence are adapters.
export function createAiConversation({ read, write, scope, request, preview, complete, persist, changed = () => {} }) {
  let revision = 0;
  let reviewed = null;
  let destroyed = false;
  const active = new Set();
  const busy = () => active.has(scope());
  function invalidate() { revision += 1; reviewed = null; changed(); }
  return {
    get busy() { return busy(); },
    get reviewed() { return reviewed?.response ?? null; },
    invalidate,
    async preview() {
      if (destroyed || busy()) return null;
      const token = ++revision, id = scope();
      reviewed = null; changed();
      const message = structuredClone(await request());
      const response = await preview(message);
      if (destroyed || token !== revision || id !== scope()) return null;
      reviewed = { response, message, id };
      changed();
      return response;
    },
    async send({ confirmed = false } = {}) {
      if (destroyed || busy() || !reviewed || reviewed.id !== scope()) return false;
      if (!confirmed) throw new Error("Operator confirmation is required");
      const { response, message, id } = reviewed;
      const chat = normalizeAiChat(read());
      active.add(id); invalidate();
      try {
        const result = await complete({ ...message, previewHash: response.preview.hash, previewEndpoint: response.endpoint, confirmed: true }, response);
        const next = finishAiTurn(chat, message.conversation.at(-1), result);
        await persist(next, id);
        if (!destroyed && scope() === id) write(next);
        return result;
      } finally { active.delete(id); if (!destroyed) changed(); }
    },
    destroy() { destroyed = true; revision += 1; reviewed = null; },
  };
}
