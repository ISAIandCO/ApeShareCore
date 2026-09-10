import { AI_CONTEXT_MAX_BYTES, compactAiContextItems } from "./chat.js";

export function selectEventFields(event, { mode, allowFields = [], selectedFields = [], denyFields = [] }) {
  const entries = Object.entries(event && typeof event === "object" ? event : {});
  const selection = new Set(mode === "allowlist" ? allowFields : selectedFields);
  const denied = denyFields.map(value => value.toLowerCase());
  return Object.fromEntries(["selected", "allowlist"].includes(mode) ? entries.filter(([key]) => selection.has(key))
    : mode === "full" ? entries : entries.filter(([key]) => !denied.some(term => key.toLowerCase().includes(term))));
}

export function createEventPrivacy({ strictFields, eventIdentity, collectionKey }) {
  const SENSITIVE_FIELD = /(password|passwd|secret|token|cookie|authorization|credential|api.?key|private.?key)/i;
  const SENSITIVE_VALUE = /((?:bearer|token|password|passwd|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi;

  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_FIELD.test(key) ? "[REDACTED]" : redact(item)]));
    return typeof value === "string" ? value.replace(SENSITIVE_VALUE, "$1[REDACTED]") : value;
  }

  function prepareEvent(event, mode = "strict") {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("Для AI требуется структурированное событие");
    if (Array.isArray(event[collectionKey])) return { [collectionKey]: event[collectionKey].slice(0, 100).map(item => prepareEvent(item, mode)) };
    if (mode === "full") return structuredClone(event);
    if (mode === "redacted") return redact(event);
    return Object.fromEntries(Object.entries(selectEventFields(event, { mode: "allowlist", allowFields: strictFields })).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  }

  function preview(event, mode = "strict") {
    const payload = prepareEvent(event, mode);
    const serialized = JSON.stringify(payload);
    return { payload, fields: Object.keys(payload), bytes: new TextEncoder().encode(serialized).byteLength, mode };
  }

  function contextEvents(context, mode) {
    const payload = prepareEvent(context, mode);
    return Array.isArray(payload[collectionKey]) ? payload[collectionKey] : [payload];
  }

  function packEvents(events) {
    return events.length === 1 ? events[0] : { [collectionKey]: events };
  }

  function mergeContexts(contexts, mode = "strict") {
    const events = contexts.filter(Boolean).flatMap((context) => contextEvents(context, mode));
    const payload = packEvents(compactAiContextItems(events, eventIdentity).slice(-100));
    const serialized = JSON.stringify(payload);
    return { payload, fields: Object.keys(payload), bytes: new TextEncoder().encode(serialized).byteLength, mode };
  }

  function contextDelta(context, previousContexts, mode = "strict") {
    const known = new Set(previousContexts.filter(Boolean).flatMap((item) => contextEvents(item, mode)).map(eventIdentity));
    const events = compactAiContextItems(contextEvents(context, mode), eventIdentity).filter((event) => !known.has(eventIdentity(event)));
    return events.length ? packEvents(events) : null;
  }

  function compactMessageContexts(messages) {
    const known = new Set();
    return messages.map((message) => {
      if (message?.role !== "user" || !message.context) return message;
      const events = contextEvents(message.context, "full");
      const fresh = events.filter((event) => !known.has(JSON.stringify(event)));
      events.forEach((event) => known.add(JSON.stringify(event)));
      const compacted = { ...message };
      if (fresh.length) compacted.context = packEvents(fresh);
      else delete compacted.context;
      return compacted;
    });
  }

  return { AI_CONTEXT_MAX_BYTES, compactMessageContexts, contextDelta, mergeContexts, prepareEvent, preview, redact };
}
