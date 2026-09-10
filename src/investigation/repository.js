import { addWorkspaceItem, createWorkspace, normalizeWorkspace } from "./model.js";
import { mergeAiChats, normalizeAiChat } from "../ai/chat.js";

export function createInvestigationRepository({ databaseFactory, name, version = 2 }) {
const STORE_NAME = "workspaces";
const CHAT_STORE_NAME = "aiChats";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

let databasePromise;
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = databaseFactory().open(name, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("siemOrigin", "siemOrigin");
      }
      if (!database.objectStoreNames.contains(CHAT_STORE_NAME)) database.createObjectStore(CHAT_STORE_NAME, { keyPath: "workspaceId" });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = null; };
      resolve(database);
    };
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("Cannot open investigation database")); };
  });
  return databasePromise;
}

async function withStore(mode, callback, storeName = STORE_NAME) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const completed = transactionDone(transaction);
  try {
    const result = await callback(transaction.objectStore(storeName));
    await completed;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* transaction already finished */ }
    await completed.catch(() => {});
    throw error;
  }
}

async function listWorkspaces() {
  const records = await withStore("readonly", (store) => requestResult(store.getAll()));
  return records.map((workspace) => normalizeWorkspace(workspace)).sort((first, second) => second.updatedAt - first.updatedAt);
}

async function getWorkspace(id) {
  if (!id) return null;
  const record = await withStore("readonly", (store) => requestResult(store.get(String(id))));
  return record ? normalizeWorkspace(record) : null;
}

async function createInvestigation(input) {
  const workspace = createWorkspace(input);
  await withStore("readwrite", (store) => requestResult(store.add(workspace)));
  return workspace;
}

async function mutateWorkspace(id, transform) {
  return withStore("readwrite", async store => {
    const existing = await requestResult(store.get(String(id)));
    if (!existing) throw new Error("Workspace not found");
    const next = transform(normalizeWorkspace(existing));
    await requestResult(store.put(next));
    return next;
  });
}

async function updateWorkspace(id, patch) {
  return mutateWorkspace(id, existing => normalizeWorkspace({
    ...existing,
    status: patch?.status ?? existing.status,
    title: patch?.title ?? existing.title,
    notes: patch?.notes ?? existing.notes,
    tags: patch?.tags ?? existing.tags,
    sourceIncidentId: patch?.sourceIncidentId ?? existing.sourceIncidentId,
    updatedAt: Date.now(),
  }));
}

async function deleteWorkspace(id) {
  const existing = await getWorkspace(id);
  if (!existing) return false;
  const database = await openDatabase();
  const transaction = database.transaction([STORE_NAME, CHAT_STORE_NAME], "readwrite");
  await Promise.all([
    requestResult(transaction.objectStore(STORE_NAME).delete(String(id))),
    requestResult(transaction.objectStore(CHAT_STORE_NAME).delete(String(id))),
  ]);
  await transactionDone(transaction);
  return true;
}

async function getWorkspaceAiChat(workspaceId) {
  if (!await getWorkspace(workspaceId)) throw new Error("Workspace not found");
  const record = await withStore("readonly", (store) => requestResult(store.get(String(workspaceId))), CHAT_STORE_NAME);
  return normalizeAiChat(record?.chat);
}

async function saveWorkspaceAiChat(workspaceId, input) {
  if (!await getWorkspace(workspaceId)) throw new Error("Workspace not found");
  const chat = normalizeAiChat(input);
  await withStore("readwrite", (store) => requestResult(store.put({ workspaceId: String(workspaceId), chat })), CHAT_STORE_NAME);
  return chat;
}

async function importWorkspaceAiChat(workspaceId, input) {
  return saveWorkspaceAiChat(workspaceId, mergeAiChats(await getWorkspaceAiChat(workspaceId), input));
}

async function removeWorkspaceItem(id, itemIndex) {
  return mutateWorkspace(id, existing => {
    const index = Number(itemIndex);
    if (!Number.isInteger(index) || index < 0 || index >= existing.items.length) throw new TypeError("Invalid workspace item index");
    existing.items.splice(index, 1);
    existing.updatedAt = Date.now();
    return existing;
  });
}

async function pinWorkspaceItem({ workspaceId, siemOrigin, sourceIncidentId, item }) {
  let workspace = workspaceId ? await getWorkspace(workspaceId) : null;
  if (!workspace) {
    const candidates = (await listWorkspaces()).filter((entry) => !siemOrigin || entry.siemOrigin === siemOrigin);
    workspace = candidates[0] ?? await createInvestigation({
      title: `Расследование ${new Date().toLocaleString("ru-RU")}`,
      siemOrigin,
      sourceIncidentId,
    });
  }
  return mutateWorkspace(workspace.id, existing => addWorkspaceItem({ ...existing, siemOrigin: existing.siemOrigin || siemOrigin || null }, item));
}

return { openDatabase, listWorkspaces, getWorkspace, createInvestigation, updateWorkspace, deleteWorkspace,
  getWorkspaceAiChat, saveWorkspaceAiChat, importWorkspaceAiChat, removeWorkspaceItem, pinWorkspaceItem };
}
