export function createGraphSnapshots({ storage, prefix = "graph:", maxSnapshots = 10, maxBytes = 64 * 1024 * 1024,
  idPattern = /^[a-z0-9_-]{8,100}$/i } = {}) {
const SNAPSHOT_PREFIX = prefix;
  const MAX_SNAPSHOTS = maxSnapshots;
  const MAX_SNAPSHOT_BYTES = maxBytes;
  const ID_PATTERN = idPattern;

  function snapshotKey(id) { return `${SNAPSHOT_PREFIX}${id}`; }

  function validateOrigin(value) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) throw new TypeError("Invalid process graph origin");
    return url.origin;
  }

  function validateSnapshot(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.response?.graph?.nodes)) throw new TypeError("Invalid process graph snapshot");
    if (input.response.graph.nodes.length > 10_000) throw new TypeError("Process graph snapshot contains too many nodes");
    const origin = validateOrigin(input.response.origin);
    const record = {
      schemaVersion: 1,
      createdAt: Date.now(),
      sourceTabId: Number.isInteger(input.sourceTabId) && input.sourceTabId > 0 ? input.sourceTabId : null,
      sourceEvent: input.sourceEvent && typeof input.sourceEvent === "object" ? structuredClone(input.sourceEvent) : {},
      response: { ...structuredClone(input.response), origin },
      ...(input.context === undefined ? {} : { context: structuredClone(input.context) }),
    };
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_SNAPSHOT_BYTES) throw new TypeError("Process graph snapshot is too large");
    return record;
  }

  async function pruneSnapshots(storageArea) {
    const stored = await storageArea.get(null);
    const snapshots = Object.entries(stored).reverse()
      .filter(([key, value]) => key.startsWith(SNAPSHOT_PREFIX) && Number.isFinite(value?.createdAt))
      .sort((first, second) => second[1].createdAt - first[1].createdAt);
    const expiredKeys = snapshots.slice(MAX_SNAPSHOTS).map(([key]) => key);
    if (expiredKeys.length) await storageArea.remove(expiredKeys);
  }

  async function saveGraphSnapshot(input, storageArea = storage, id = crypto.randomUUID()) {
    if (!ID_PATTERN.test(String(id))) throw new TypeError("Invalid process graph snapshot ID");
    const snapshot = { id, ...validateSnapshot(input) };
    await storageArea.set({ [snapshotKey(id)]: snapshot });
    await pruneSnapshots(storageArea);
    return { id, createdAt: snapshot.createdAt };
  }

  async function getGraphSnapshot(id, storageArea = storage) {
    if (!ID_PATTERN.test(String(id ?? ""))) throw new TypeError("Invalid process graph snapshot ID");
    const key = snapshotKey(id);
    const snapshot = (await storageArea.get(key))[key];
    if (!snapshot) return null;
    if (snapshot.schemaVersion !== 1 || snapshot.id !== id || !Number.isFinite(snapshot.createdAt)) throw new TypeError("Invalid stored process graph snapshot");
    validateSnapshot(snapshot);
    return snapshot;
  }

  async function updateGraphSnapshot(id, input, storageArea = storage) {
    if (!ID_PATTERN.test(String(id ?? ""))) throw new TypeError("Invalid process graph snapshot ID");
    const existing = await getGraphSnapshot(id, storageArea);
    if (!existing) throw new Error("Process graph snapshot not found");
    const validated = validateSnapshot({
      sourceTabId: input?.sourceTabId ?? existing.sourceTabId,
      sourceEvent: input?.sourceEvent ?? existing.sourceEvent,
      response: input?.response,
      context: input?.context ?? existing.context,
    });
    const snapshot = { ...validated, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
    await storageArea.set({ [snapshotKey(id)]: snapshot });
    return { id: snapshot.id, createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt };
  }

  async function deleteGraphSnapshot(id, storageArea = storage) {
    if (!ID_PATTERN.test(String(id ?? ""))) return false;
    await storageArea.remove(snapshotKey(id));
    return true;
  }

  return { saveGraphSnapshot, getGraphSnapshot, updateGraphSnapshot, deleteGraphSnapshot };
}
