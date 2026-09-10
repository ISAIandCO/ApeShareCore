import { eventDiffToMarkdown, compareEvents } from "../events/compare.js";
import { sanitizeFilenamePart } from "../values/url.js";
import { addAiAttachment, appendAiMessage, normalizeAiChat } from "../ai/chat.js";
import { renderChatMessages } from "./chat-messages.js";
import { InvestigationCanvas } from "./investigation-canvas.js";
import { parseSiemTime, rangeAroundEvents } from "../values/time.js";

export function mountWorkspace(root, adapter) {
const document = root.ownerDocument ?? root;
const window = document.defaultView;
const { navigator, location } = window;
const confirm = message => window.confirm(message);
const byId = id => root.querySelector(`#${id}`);
const { request, buildInvestigationGraph, describeInvestigationEvent,
  requestAiCompletion, workspaceToJson, workspaceToMarkdown, downloadText } = adapter;
const listeners = [];
let destroyed = false;
let revision = 0;
let aiRevision = 0;
const sending = new Set();
function listen(target, type, handler) {
  target.addEventListener(type, handler);
  listeners.push(() => target.removeEventListener(type, handler));
}
const state = {
  workspaces: [], selectedId: null, compareIndexes: new Set(), compare: null,
  aiIndexes: new Set(), aiChat: normalizeAiChat(), aiPreviewHash: null, settings: null, relatedResults: [],
};
let aiSaveTimer;
let investigationCanvas;
const investigationForceControls = Object.freeze({
  attraction: { input: "workspace-force-attraction", output: "workspace-force-attraction-value", digits: 2 },
  repulsion: { input: "workspace-force-repulsion", output: "workspace-force-repulsion-value", digits: 2 },
  linkStrength: { input: "workspace-force-link-strength", output: "workspace-force-link-strength-value", digits: 2 },
  linkDistance: { input: "workspace-force-link-distance", output: "workspace-force-link-distance-value", digits: 0 },
});

function setStatus(message, error = false) {
  byId("workspace-status").textContent = message;
  byId("workspace-status").classList.toggle("error", error);
}

function selectedWorkspace() { return state.workspaces.find((workspace) => workspace.id === state.selectedId) ?? null; }
function formatEventTime(value) { return parseSiemTime(value)?.toLocaleString("ru-RU") ?? "Время не указано"; }

function renderInvestigationForceControls() {
  for (const [name, control] of Object.entries(investigationForceControls)) {
    byId(control.input).value = investigationCanvas.forceSettings[name];
    byId(control.output).textContent = investigationCanvas.forceSettings[name].toFixed(control.digits);
  }
}

function filteredWorkspaces() {
  const search = byId("workspace-search").value.trim().toLowerCase();
  const sort = byId("workspace-sort").value;
  return state.workspaces.filter((workspace) => !search || `${workspace.title} ${workspace.tags.join(" ")} ${workspace.notes}`.toLowerCase().includes(search))
    .sort(sort === "title" ? (first, second) => first.title.localeCompare(second.title, "ru")
      : sort === "created" ? (first, second) => second.createdAt - first.createdAt
        : (first, second) => second.updatedAt - first.updatedAt);
}

function renderList() {
  const list = byId("workspace-list");
  list.replaceChildren();
  for (const workspace of filteredWorkspaces()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = workspace.id === state.selectedId ? "active" : "";
    const title = document.createElement("strong"); title.textContent = workspace.title;
    const metadata = document.createElement("span"); metadata.textContent = `${workspace.items.length} объектов · ${new Date(workspace.updatedAt).toLocaleString("ru-RU")}`;
    button.append(title, metadata);
    button.addEventListener("click", () => selectWorkspace(workspace.id).catch((error) => setStatus(error.message, true)));
    list.append(button);
  }
  if (!list.children.length) list.textContent = "Расследования не найдены.";
}

function snapshotDetails(item) {
  const details = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "Локальный snapshot";
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(item.snapshot, null, 2);
  details.append(summary, pre);
  return details;
}

function sortWorkspaceItems(items, order) {
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    if (order === "added") return a.item.createdAt - b.item.createdAt;
    const first = parseSiemTime(adapter.eventTime(a.item.snapshot, a.item))?.valueOf() ?? a.item.createdAt;
    const second = parseSiemTime(adapter.eventTime(b.item.snapshot, b.item))?.valueOf() ?? b.item.createdAt;
    return order === "time-desc" ? second - first : first - second;
  });
}

function renderItems(workspace) {
  const list = byId("workspace-items");
  list.replaceChildren();
  for (const { item, index } of sortWorkspaceItems(workspace.items, byId("workspace-item-sort").value)) {
    const article = document.createElement("article");
    const heading = document.createElement("div"); heading.className = "item-heading";
    const eventView = item.type === "event" ? describeInvestigationEvent(item.snapshot) : null;
    const title = document.createElement("h3"); title.textContent = eventView?.title ?? `${item.type}: ${item.label}`;
    const actions = document.createElement("div"); actions.className = "item-actions";
    if (item.type === "event") {
      const label = document.createElement("label"); label.className = "compare-choice";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.compareIndexes.has(index);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && state.compareIndexes.size >= 3) { checkbox.checked = false; setStatus("Для сравнения можно выбрать не более трёх событий", true); return; }
        if (checkbox.checked) state.compareIndexes.add(index); else state.compareIndexes.delete(index);
        renderCompare(workspace);
      });
      label.append(checkbox, document.createTextNode(" сравнить")); actions.append(label);
    }
    const aiLabel = document.createElement("label"); aiLabel.className = "compare-choice";
    const aiCheckbox = document.createElement("input"); aiCheckbox.type = "checkbox"; aiCheckbox.checked = state.aiIndexes.has(index);
    aiCheckbox.addEventListener("change", () => { if (aiCheckbox.checked) state.aiIndexes.add(index); else state.aiIndexes.delete(index); });
    aiLabel.append(aiCheckbox, document.createTextNode(" в AI")); actions.append(aiLabel);
    if (adapter.canOpenEvent(workspace, item)) {
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Открыть событие";
      open.addEventListener("click", () => adapter.openEvent(workspace, item).catch(error => setStatus(error.message, true))); actions.append(open);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "Удалить";
    remove.addEventListener("click", () => removeItem(index).catch((error) => setStatus(error.message, true))); actions.append(remove);
    heading.append(title, actions);
    const value = document.createElement("p");
    value.textContent = item.type === "event"
      ? `${formatEventTime(adapter.eventTime(item.snapshot, item))} · ${eventView.description}`
      : item.value;
    article.append(heading, value, snapshotDetails(item));
    list.append(article);
  }
  if (!workspace.items.length) list.textContent = "Пока нет прикреплённых объектов. Используйте popup или правый клик по узлу графа.";
}

function renderGraphSelection(nodes = investigationCanvas?.selectedNodes() ?? []) {
  const container = byId("graph-selected-entities"); container.replaceChildren();
  for (const node of nodes) {
    const chip = document.createElement("span"); chip.textContent = `${node.typeLabel}: ${node.label}`; container.append(chip);
  }
  if (!nodes.length) container.textContent = "Сущности для поиска не выбраны.";
  byId("graph-search").disabled = !nodes.length || !adapter.canSearch(selectedWorkspace());
}

function renderInvestigationGraph(workspace) {
  const graph = buildInvestigationGraph(workspace.items, { sharedOnly: byId("graph-shared-only").checked });
  const words = byId("workspace-event-search").value.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const events = new Set(graph.nodes.filter(node => node.kind === "event" && words.every(word => JSON.stringify(workspace.items[node.itemIndex]?.snapshot).toLowerCase().includes(word))).map(node => node.id));
    const entities = new Set(graph.edges.filter(edge => events.has(edge.sourceId)).map(edge => edge.targetId));
    graph.nodes = graph.nodes.filter(node => events.has(node.id) || entities.has(node.id));
    graph.edges = graph.edges.filter(edge => events.has(edge.sourceId) && entities.has(edge.targetId));
  }
  investigationCanvas.setGraph(graph);
  const eventCount = graph.nodes.filter((node) => node.kind === "event").length;
  const entityCount = graph.nodes.length - eventCount;
  byId("investigation-graph-summary").textContent = `${eventCount} событий · ${entityCount} сущностей · ${graph.edges.length} связей. Квадраты — события, круги — свойства.`;
  renderGraphSelection();
}

function renderRelatedResults() {
  const container = byId("graph-search-results"); container.replaceChildren();
  for (const event of state.relatedResults) {
    const article = document.createElement("article");
    const content = document.createElement("div");
    const view = describeInvestigationEvent(event);
    const title = document.createElement("strong"); title.textContent = view.title;
    const description = document.createElement("p"); description.textContent = `${formatEventTime(adapter.eventTime(event))} · ${view.description}`;
    const add = document.createElement("button"); add.type = "button"; add.textContent = "Добавить в расследование";
    add.addEventListener("click", () => addRelatedEvent(event).catch((error) => setStatus(error.message, true)));
    content.append(title, description); article.append(content, add); container.append(article);
  }
  if (!state.relatedResults.length) container.textContent = "Новых событий по выбранным связям не найдено.";
}

function resetRelatedSearch() {
  state.relatedResults = [];
  byId("graph-search-status").textContent = "";
  byId("graph-search-results").replaceChildren();
  investigationCanvas?.clearSelection();
}

async function searchRelatedEvents() {
  const workspace = selectedWorkspace();
  if (!adapter.canSearch(workspace)) throw new Error("Расследование не связано с экземпляром SIEM");
  const selected = investigationCanvas.selectedNodes();
  if (!selected.length) throw new Error("Выберите на графе хотя бы одну сущность");
  state.relatedResults = [];
  byId("graph-search-results").replaceChildren();
  byId("graph-search").disabled = true;
  byId("graph-search-status").textContent = "Ищу события в SIEM…";
  try {
    const token = revision;
    const rangeSeconds = Number(byId("graph-search-range").value) || 3600;
    const period = rangeAroundEvents(workspace.items.filter(item => item.type === "event"), item => adapter.eventTime(item.snapshot, item), rangeSeconds);
    const { events, query = "" } = await adapter.searchEntities(workspace, selected, {
      mode: byId("graph-search-mode").value, rangeSeconds, period, limit: 100,
    });
    if (destroyed || token !== revision) return;
    const existing = new Set(workspace.items.filter(item => item.type === "event").map(item => adapter.eventIdentity(item.snapshot)));
    state.relatedResults = events.filter(event => !existing.has(adapter.eventIdentity(event))).slice(0, 100);
    byId("graph-search-status").textContent = `${query ? `Фильтр: ${query} · ` : ""}найдено новых событий: ${state.relatedResults.length}${events.length >= 100 ? " (показаны первые 100)" : ""}`;
    renderRelatedResults();
  } finally {
    renderGraphSelection();
  }
}

async function addRelatedEvent(event) {
  const workspace = selectedWorkspace();
  const view = describeInvestigationEvent(event);
  await request({
    type: "workspace:item:add", workspaceId: workspace.id, siemOrigin: workspace.siemOrigin,
    item: adapter.eventItem(event),
  });
  state.relatedResults = state.relatedResults.filter((candidate) => candidate !== event);
  await refresh({ selectId: workspace.id });
  byId("graph-search-status").textContent = `Событие «${view.title}» добавлено в расследование`;
  renderRelatedResults();
}

function renderCompare(workspace) {
  const panel = byId("compare-panel");
  const indexes = [...state.compareIndexes].sort((a, b) => a - b);
  panel.hidden = indexes.length < 2;
  if (indexes.length < 2) { state.compare = null; return; }
  const items = indexes.map((index) => workspace.items[index]);
  state.compare = compareEvents(items.map((item) => item.snapshot));
  byId("compare-event-3").hidden = state.compare.eventCount < 3;
  const tbody = byId("compare-body"); tbody.replaceChildren();
  for (const row of state.compare.rows) {
    const tr = document.createElement("tr");
    for (const value of [row.group, row.field, row.status, ...row.values.map((item) => item === undefined ? "—" : typeof item === "object" ? JSON.stringify(item) : String(item))]) {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    }
    tbody.append(tr);
  }
  byId("compare-summary").textContent = `${state.compare.rows.filter((row) => row.status === "same").length} одинаковых · ${state.compare.rows.filter((row) => row.status === "changed").length} изменённых · ${state.compare.rows.filter((row) => row.status === "only").length} присутствуют не во всех событиях`;
}

function invalidateAiPreview() {
  aiRevision += 1;
  state.aiPreviewHash = null;
  byId("workspace-ai-run").disabled = true;
  byId("workspace-ai-preview-output").textContent = "";
  byId("workspace-ai-preview-meta").textContent = "";
}

async function loadWorkspaceChat() {
  if (!state.selectedId) { state.aiChat = normalizeAiChat(); return; }
  const id = state.selectedId;
  const token = revision;
  const response = await request({ type: "workspace:chat:get", id });
  if (destroyed || token !== revision || id !== state.selectedId) return;
  state.aiChat = normalizeAiChat(response.chat);
}

async function saveWorkspaceChat(workspaceId = state.selectedId, chat = state.aiChat) {
  if (!workspaceId) return;
  clearTimeout(aiSaveTimer);
  await request({ type: "workspace:chat:save", id: workspaceId, chat });
}

function scheduleWorkspaceChatSave() {
  clearTimeout(aiSaveTimer);
  const workspaceId = state.selectedId;
  const chat = normalizeAiChat(state.aiChat);
  aiSaveTimer = setTimeout(() => saveWorkspaceChat(workspaceId, chat).catch((error) => setStatus(error.message, true)), 300);
}

function workspaceConversationWithDraft() {
  const content = state.aiChat.draft.trim() || "Используй приложенные данные для продолжения расследования.";
  return [...state.aiChat.messages, { role: "user", content, attachments: state.aiChat.pendingAttachments }];
}

function workspaceToolDescription(call) {
  if (call.name !== "get_workspace_objects") return call.name;
  const types = Array.isArray(call.arguments.types) ? call.arguments.types.join(", ") : "все типы";
  return `объекты расследования: ${types}, максимум ${Math.max(1, Math.min(8, Number(call.arguments.maxItems) || 8))}`;
}

function renderWorkspaceToolRequests() {
  const panel = byId("workspace-ai-tool-requests"); panel.replaceChildren();
  panel.hidden = !state.aiChat.pendingToolCalls.length;
  if (!state.aiChat.pendingToolCalls.length) return;
  const title = document.createElement("strong"); title.textContent = "AI запрашивает дополнительный локальный контекст:"; panel.append(title);
  const list = document.createElement("ul");
  for (const call of state.aiChat.pendingToolCalls) { const item = document.createElement("li"); item.textContent = workspaceToolDescription(call); list.append(item); }
  const run = document.createElement("button"); run.type = "button"; run.textContent = "Подтвердить добавление объектов";
  run.addEventListener("click", () => executeWorkspaceToolCalls().catch((error) => setStatus(error.message, true)));
  panel.append(list, run);
}

function renderAiWorkspace() {
  const workspace = selectedWorkspace();
  const panel = byId("workspace-ai");
  panel.hidden = !workspace || state.settings?.features?.aiAssistant === false;
  if (!workspace || panel.hidden) return;
  const messages = byId("workspace-ai-messages");
  renderChatMessages(messages, state.aiChat.messages, { messageClass: "workspace-ai-message", attachmentsClass: "workspace-ai-attachments", emptyText: "Постоянный диалог этого расследования пока пуст." });
  const pending = byId("workspace-ai-context"); pending.replaceChildren();
  state.aiChat.pendingAttachments.forEach((attachment, index) => {
    const chip = document.createElement("span"); chip.textContent = `${attachment.type}: ${attachment.label}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
    remove.addEventListener("click", () => { state.aiChat.pendingAttachments.splice(index, 1); invalidateAiPreview(); renderAiWorkspace(); scheduleWorkspaceChatSave(); });
    chip.append(remove); pending.append(chip);
  });
  byId("workspace-ai-message").value = state.aiChat.draft;
  byId("workspace-ai-tools").checked = state.aiChat.allowSiemTools;
  byId("workspace-ai-preview").disabled = !state.settings?.ai?.endpoint || !state.settings?.ai?.model;
  renderWorkspaceToolRequests();
  for (const id of ["workspace-ai-message", "workspace-ai-tools", "workspace-ai-clear", "workspace-ai-add-selected", "workspace-ai-add-notes"]) byId(id).disabled = sending.has(workspace.id);
  if (sending.has(workspace.id)) byId("workspace-ai-preview").disabled = true;
}

function addSelectedWorkspaceItems() {
  const workspace = selectedWorkspace();
  for (const index of state.aiIndexes) {
    const item = workspace.items[index];
    if (item) state.aiChat = addAiAttachment(state.aiChat, item);
  }
  state.aiIndexes.clear(); invalidateAiPreview(); render(); scheduleWorkspaceChatSave();
}

function addWorkspaceNotes() {
  const workspace = selectedWorkspace();
  if (!workspace.notes.trim()) throw new Error("В расследовании нет заметок аналитика");
  state.aiChat = addAiAttachment(state.aiChat, { type: "note", value: `notes:${workspace.id}`, label: "Заметки аналитика", snapshot: { notes: workspace.notes } });
  invalidateAiPreview(); renderAiWorkspace(); scheduleWorkspaceChatSave();
}

async function executeWorkspaceToolCalls() {
  const workspace = selectedWorkspace();
  const calls = [...state.aiChat.pendingToolCalls];
  if (!calls.length || !confirm(`Добавить в следующее сообщение данные для ${calls.length} показанных запросов AI?`)) return;
  for (const call of calls) {
    if (call.name !== "get_workspace_objects") throw new Error("AI запросил неподдерживаемый инструмент");
    const allowed = new Set(["event", "process", "ioc", "host", "account", "incident", "note"]);
    const types = new Set((Array.isArray(call.arguments.types) ? call.arguments.types : []).filter((type) => allowed.has(type)));
    const limit = Math.max(1, Math.min(8, Number(call.arguments.maxItems) || 8));
    const items = workspace.items.filter((item) => !types.size || types.has(item.type)).slice(0, limit);
    for (const item of items) state.aiChat = addAiAttachment(state.aiChat, item);
  }
  state.aiChat.pendingToolCalls = [];
  state.aiChat.draft = "Используй подтверждённые объекты Investigation Workspace для продолжения анализа.";
  invalidateAiPreview(); renderAiWorkspace(); await saveWorkspaceChat();
}

async function previewWorkspaceAi() {
  const token = ++aiRevision;
  const workspaceId = state.selectedId;
  byId("workspace-ai-run").disabled = true;
  byId("workspace-ai-preview-meta").textContent = "Формирую payload локально…";
  const response = await request({
    type: "ai:preview", conversation: workspaceConversationWithDraft(), contextType: "workspace",
    selectedFields: state.settings.ai.selectedFields, allowSiemTools: state.aiChat.allowSiemTools,
  });
  if (destroyed || token !== aiRevision || workspaceId !== state.selectedId) return;
  state.aiPreviewHash = response.preview.hash;
  byId("workspace-ai-preview-output").textContent = response.preview.serialized;
  const warnings = response.preview.warnings.length ? `\nПредупреждения:\n- ${response.preview.warnings.join("\n- ")}` : "";
  byId("workspace-ai-preview-meta").textContent = `${response.preview.byteLength} UTF-8 bytes · destination ${response.endpoint}${warnings}`;
  byId("workspace-ai-run").disabled = false;
}

async function runWorkspaceAi() {
  const workspaceId = state.selectedId;
  if (!state.aiPreviewHash || sending.has(workspaceId)) return;
  if (!confirm(`Отправить в ${state.settings.ai.endpoint} ровно показанный payload?`)) return;
  const outbound = workspaceConversationWithDraft();
  let chat = normalizeAiChat(state.aiChat);
  const message = { conversation: outbound, contextType: "workspace", selectedFields: state.settings.ai.selectedFields,
    allowSiemTools: chat.allowSiemTools, previewHash: state.aiPreviewHash, confirmed: true };
  sending.add(workspaceId); invalidateAiPreview(); renderAiWorkspace();
  try {
    const result = await requestAiCompletion(message);
    chat = appendAiMessage(chat, outbound.at(-1));
    const toolCalls = result.toolCalls ?? [];
    chat = appendAiMessage(chat, { role: "assistant", content: result.content || `Запрошены дополнительные данные: ${toolCalls.map(workspaceToolDescription).join("; ")}`, toolCalls });
    chat.draft = ""; chat.pendingAttachments = []; chat.pendingToolCalls = toolCalls;
    await saveWorkspaceChat(workspaceId, chat);
    if (!destroyed && state.selectedId === workspaceId) { state.aiChat = chat; invalidateAiPreview(); }
  } finally {
    sending.delete(workspaceId);
    if (!destroyed) renderAiWorkspace();
  }
}

function renderEditor() {
  const workspace = selectedWorkspace();
  byId("workspace-empty").hidden = Boolean(workspace);
  byId("workspace-editor").hidden = !workspace;
  if (!workspace) return;
  byId("workspace-title").value = workspace.title;
  byId("workspace-state").value = workspace.status ?? "open";
  byId("workspace-origin").textContent = workspace.siemOrigin ?? "SIEM origin не указан";
  byId("workspace-tags").value = workspace.tags.join(", ");
  byId("workspace-notes").value = workspace.notes;
  renderItems(workspace);
  renderInvestigationGraph(workspace);
  renderCompare(workspace);
  renderAiWorkspace();
}

function render() { renderList(); renderEditor(); }

async function refresh({ selectId = state.selectedId } = {}) {
  const previousId = state.selectedId;
  const token = ++revision;
  const response = await request({ type: "workspace:list" });
  if (destroyed || token !== revision) return;
  state.workspaces = response.workspaces;
  state.selectedId = state.workspaces.some((workspace) => workspace.id === selectId) ? selectId : state.workspaces[0]?.id ?? null;
  if (state.selectedId !== previousId) resetRelatedSearch();
  await loadWorkspaceChat();
  render();
}

async function selectWorkspace(id) {
  if (state.selectedId && state.selectedId !== id) await saveWorkspaceChat();
  revision += 1;
  state.selectedId = id;
  window.history.replaceState(null, "", `?id=${encodeURIComponent(id)}`);
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  invalidateAiPreview();
  resetRelatedSearch();
  await loadWorkspaceChat();
  render();
}

async function createNew() {
  await saveWorkspaceChat();
  const response = await request({ type: "workspace:create", workspace: { title: "Новое расследование" } });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: response.workspace.id });
  byId("workspace-title").focus();
}

async function saveCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace) return;
  await saveWorkspaceChat();
  const response = await request({
    type: "workspace:update",
    id: workspace.id,
    patch: {
      title: byId("workspace-title").value,
      status: byId("workspace-state").value,
      tags: byId("workspace-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: byId("workspace-notes").value,
    },
  });
  await refresh({ selectId: response.workspace.id });
  setStatus("Расследование сохранено локально");
}

async function deleteCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace || !confirm(`Удалить расследование «${workspace.title}»? Это действие нельзя отменить.`)) return;
  clearTimeout(aiSaveTimer);
  await request({ type: "workspace:delete", id: workspace.id });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: null });
  setStatus("Расследование удалено");
}

async function removeItem(index) {
  const workspace = selectedWorkspace();
  await saveWorkspaceChat();
  await request({ type: "workspace:item:remove", id: workspace.id, index });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: workspace.id });
}

async function download(text, extension, mime) {
  const workspace = selectedWorkspace();
  await downloadText(text, { filename: `${adapter.filenamePrefix ?? "ape"}-${sanitizeFilenamePart(workspace.title) || workspace.id}.${extension}`, mime });
}

function compareLabels(workspace) { return [...state.compareIndexes].sort((a, b) => a - b).map((index) => workspace.items[index].label); }

listen(byId("workspace-new"), "click", () => createNew().catch((error) => setStatus(error.message, true)));
listen(byId("workspace-save"), "click", () => saveCurrent().catch((error) => setStatus(error.message, true)));
listen(byId("workspace-delete"), "click", () => deleteCurrent().catch((error) => setStatus(error.message, true)));
listen(byId("workspace-search"), "input", renderList);
listen(byId("workspace-sort"), "change", renderList);
listen(byId("workspace-item-sort"), "change", () => selectedWorkspace() && renderItems(selectedWorkspace()));
listen(byId("workspace-event-search"), "input", () => selectedWorkspace() && renderInvestigationGraph(selectedWorkspace()));
listen(byId("graph-shared-only"), "change", () => selectedWorkspace() && renderInvestigationGraph(selectedWorkspace()));
listen(byId("graph-fit"), "click", () => investigationCanvas.fit());
listen(byId("graph-clear-selection"), "click", () => investigationCanvas.clearSelection());
listen(byId("graph-search"), "click", () => searchRelatedEvents().catch((error) => { byId("graph-search-status").textContent = error.message; setStatus(error.message, true); renderGraphSelection(); }));
for (const [name, control] of Object.entries(investigationForceControls)) {
  listen(byId(control.input), "input", (event) => {
    investigationCanvas.updateForceSetting(name, event.target.value);
    renderInvestigationForceControls();
  });
  listen(byId(control.input), "change", () => investigationCanvas.persistForceSettings());
}
listen(byId("workspace-force-reset"), "click", () => { investigationCanvas.resetForceSettings(); renderInvestigationForceControls(); });
listen(byId("export-json"), "click", () => download(workspaceToJson(selectedWorkspace()), "json", "application/json").catch((error) => setStatus(error.message, true)));
listen(byId("export-markdown"), "click", () => download(workspaceToMarkdown(selectedWorkspace()), "md", "text/markdown").catch((error) => setStatus(error.message, true)));
listen(byId("copy-compare-json"), "click", () => navigator.clipboard.writeText(JSON.stringify(state.compare, null, 2)).catch((error) => setStatus(error.message, true)));
listen(byId("copy-compare-markdown"), "click", () => navigator.clipboard.writeText(eventDiffToMarkdown(state.compare, compareLabels(selectedWorkspace()))).catch((error) => setStatus(error.message, true)));
listen(byId("workspace-ai-add-selected"), "click", () => {
  try { addSelectedWorkspaceItems(); } catch (error) { setStatus(error.message, true); }
});
listen(byId("workspace-ai-add-notes"), "click", () => {
  try { addWorkspaceNotes(); } catch (error) { setStatus(error.message, true); }
});
listen(byId("workspace-ai-message"), "input", (event) => {
  state.aiChat.draft = event.target.value; state.aiChat.updatedAt = Date.now(); invalidateAiPreview(); scheduleWorkspaceChatSave();
});
listen(byId("workspace-ai-tools"), "change", (event) => {
  state.aiChat.allowSiemTools = event.target.checked; state.aiChat.updatedAt = Date.now(); invalidateAiPreview(); scheduleWorkspaceChatSave();
});
listen(byId("workspace-ai-clear"), "click", () => {
  if (!confirm("Очистить постоянный AI-диалог этого расследования?")) return;
  state.aiChat = normalizeAiChat({ allowSiemTools: state.aiChat.allowSiemTools });
  invalidateAiPreview(); renderAiWorkspace(); saveWorkspaceChat().catch((error) => setStatus(error.message, true));
});
listen(byId("workspace-ai-preview"), "click", () => previewWorkspaceAi().catch((error) => setStatus(error.message, true)));
listen(byId("workspace-ai-run"), "click", () => runWorkspaceAi().catch((error) => setStatus(error.message, true)));

async function initialize() {
  investigationCanvas = new InvestigationCanvas(byId("investigation-graph-canvas"), byId("investigation-graph-tooltip"), {
    forceSettings: adapter.loadForceSettings?.(),
    saveForceSettings: adapter.saveForceSettings,
    onSelectionChange: renderGraphSelection,
    onEventOpen: (node) => {
      const workspace = selectedWorkspace();
      const item = workspace.items[node.itemIndex];
      if (adapter.canOpenEvent(workspace, item)) adapter.openEvent(workspace, item).catch(error => setStatus(error.message, true));
    },
  });
  renderInvestigationForceControls();
  const settingsResponse = await request({ type: "settings:get" });
  if (destroyed) return;
  state.settings = settingsResponse.settings;
  const requestedId = new URLSearchParams(location.search).get("id");
  await refresh({ selectId: requestedId });
}

const ready = initialize().catch((error) => {
  byId("workspace-empty").textContent = error.message;
  setStatus(error.message, true);
});

return { state, ready, refresh, selectWorkspace, destroy() {
  destroyed = true; revision += 1; clearTimeout(aiSaveTimer);
  investigationCanvas?.destroy();
  for (const remove of listeners) remove();
} };
}
