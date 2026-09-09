import { normalizeWorkspaceItem } from "../investigation/model.js";

export const AI_CHAT_MAX_BYTES = 2 * 1024 * 1024;
export const AI_CONTEXT_MAX_BYTES = AI_CHAT_MAX_BYTES;
const MAX_MESSAGES = 80;
const MAX_ATTACHMENTS = 8;
const MAX_TEXT = 100_000;

function text(value, maximum = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maximum);
}

function normalizeToolCall(input) {
  const id = text(input?.id, 200);
  const name = text(input?.name, 80);
  if (!id || !name) return null;
  return { id, name, arguments: input?.arguments && typeof input.arguments === "object" ? input.arguments : {} };
}

export function normalizeAiAttachment(input) {
  return normalizeWorkspaceItem(input);
}

export function compactAiContextItems(input, identity = (item) => JSON.stringify(item)) {
  if (!Array.isArray(input)) return [];
  if (typeof identity !== "function") throw new TypeError("AI context identity must be a function");
  const items = [];
  const positions = new Map();
  for (const item of input.filter((value) => value !== null && value !== undefined)) {
    const key = String(identity(item));
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, items.length);
      items.push(item);
    } else items[position] = item;
  }
  return items;
}

function attachmentIdentity(attachment) {
  return `${attachment.type}\u0000${attachment.value}`;
}

function normalizeAiAttachments(input) {
  return (Array.isArray(input) ? input : []).slice(0, MAX_ATTACHMENTS).flatMap((attachment) => {
    try { return [normalizeAiAttachment(attachment)]; }
    catch { return []; }
  });
}

export function normalizeAiMessage(input, now = Date.now()) {
  const role = input?.role === "assistant" ? "assistant" : input?.role === "user" ? "user" : null;
  if (!role) return null;
  const content = text(input.content);
  const attachments = role === "user"
    ? normalizeAiAttachments(input.attachments)
    : [];
  const toolCalls = role === "assistant"
    ? (Array.isArray(input.toolCalls) ? input.toolCalls : []).map(normalizeToolCall).filter(Boolean).slice(0, 8)
    : [];
  if (!content.trim() && !attachments.length && !toolCalls.length) return null;
  return {
    id: text(input.id, 200) || crypto.randomUUID(),
    role,
    content,
    attachments,
    toolCalls,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
  };
}

function deduplicateMessageAttachments(messages) {
  const lastOccurrence = new Map();
  let occurrence = 0;
  for (const message of messages) {
    for (const attachment of message.attachments) lastOccurrence.set(attachmentIdentity(attachment), occurrence++);
  }
  occurrence = 0;
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments.filter((attachment) => {
      const key = attachmentIdentity(attachment);
      return lastOccurrence.get(key) === occurrence++;
    }),
  }));
}

export function compactAiConversation(input, now = Date.now()) {
  const messages = (Array.isArray(input) ? input : []).map((message) => normalizeAiMessage(message, now)).filter(Boolean);
  const attachments = compactAiContextItems(messages.flatMap((message) => message.attachments), attachmentIdentity);
  return {
    messages: messages.map((message) => ({ ...message, attachments: [] })),
    attachments,
  };
}

export function normalizeAiChat(input = {}, now = Date.now()) {
  if (!input || typeof input !== "object") input = {};
  const messages = deduplicateMessageAttachments((Array.isArray(input.messages) ? input.messages : [])
    .map((message) => normalizeAiMessage(message, now)).filter(Boolean).slice(-MAX_MESSAGES));
  const chat = {
    messages,
    draft: text(input.draft, 20_000),
    pendingAttachments: normalizeAiAttachments(input.pendingAttachments),
    pendingToolCalls: (Array.isArray(input.pendingToolCalls) ? input.pendingToolCalls : [])
      .map(normalizeToolCall).filter(Boolean).slice(0, 8),
    selectedFields: [...new Set((Array.isArray(input.selectedFields) ? input.selectedFields : []).map((field) => text(field, 300)).filter(Boolean))].slice(0, 500),
    allowSiemTools: input.allowSiemTools === true,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
  };
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES && chat.messages.length > 1) chat.messages.shift();
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES) {
    const message = chat.messages.find((entry) => entry.attachments.length);
    if (!message) break;
    message.attachments.shift();
  }
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES && chat.pendingAttachments.length) chat.pendingAttachments.pop();
  if (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES) throw new TypeError("AI chat exceeds 2 MiB");
  return chat;
}

export function addAiAttachment(chat, attachment) {
  const next = normalizeAiChat(chat);
  const item = normalizeAiAttachment(attachment);
  const duplicate = next.pendingAttachments.findIndex((entry) => entry.type === item.type && entry.value === item.value);
  if (duplicate >= 0) next.pendingAttachments[duplicate] = item;
  else next.pendingAttachments.push(item);
  next.pendingAttachments = next.pendingAttachments.slice(-MAX_ATTACHMENTS);
  next.updatedAt = Date.now();
  return normalizeAiChat(next);
}

export function appendAiMessage(chat, message) {
  const next = normalizeAiChat(chat);
  const normalized = normalizeAiMessage(message);
  if (normalized && !next.messages.some((entry) => entry.id === normalized.id)) next.messages.push(normalized);
  next.messages = next.messages.slice(-MAX_MESSAGES);
  next.updatedAt = Date.now();
  return normalizeAiChat(next);
}

export function mergeAiChats(target, source) {
  let merged = normalizeAiChat(target);
  for (const message of normalizeAiChat(source).messages) merged = appendAiMessage(merged, message);
  return merged;
}
