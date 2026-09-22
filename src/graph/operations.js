export const OPERATION_CATEGORIES = Object.freeze({
  files: 'Файловые операции', network: 'Сетевые соединения', dns: 'DNS-запросы',
  registry: 'Реестр Windows', access: 'Доступ к процессам / памяти', modules: 'Загрузка модулей',
});
export const OPERATION_PAGE_SIZE = 25;
export const canonicalPid = value => {
  const text = String(value ?? '').trim();
  try { return /^(0x[\da-f]+|\d+)$/i.test(text) ? BigInt(text).toString() : text; } catch { return text; }
};
export const canonicalGuid = value => String(value ?? '').trim().replace(/[{}]/g, '').toLowerCase();
export function operationContext(process, range, peers = []) {
  const from = Math.max(Number(range.from), Number(process.time));
  let to = Number(range.to);
  if (!process.host || (!process.guid && !canonicalPid(process.pid)) || !Number.isFinite(from) || !Number.isFinite(to)) throw new Error('У процесса нет хоста, идентификатора или времени');
  {
    for (const peer of peers) {
      if (peer.host === process.host && canonicalPid(peer.pid) === canonicalPid(process.pid) && peer.time > process.time && (!process.guid || canonicalGuid(peer.guid) !== canonicalGuid(process.guid))) to = Math.min(to, peer.time - 1);
    }
  }
  if (from > to) throw new Error('Процесс вне выбранного временного диапазона');
  return { ...process, pid: canonicalPid(process.pid), guid: canonicalGuid(process.guid), from, to };
}
export function matchesOperation(fact, process) {
  if (!fact || fact.host !== process.host || !Number.isFinite(fact.time) || fact.time < process.from || fact.time > process.to) return false;
  if (process.guid && fact.guid) return canonicalGuid(fact.guid) === process.guid;
  return Boolean(process.pid) && canonicalPid(fact.pid) === process.pid;
}
export function groupOperations(facts) {
  const groups = new Map();
  for (const fact of facts) {
    if (!fact.objectKey) continue;
    let group = groups.get(fact.objectKey);
    if (!group) groups.set(fact.objectKey, group = { key: fact.objectKey, label: fact.label, events: [] });
    group.events.push(fact);
  }
  return [...groups.values()];
}
// One independent cursor and request token per process/category. Query adapters must
// return <=25 raw records, including records rejected during normalization.
export function createOperationStore(fetchPage) {
  const entries = new Map();
  let generation = 0;
  const keyFor = (process, category) => JSON.stringify([process.nodeId, process.host, process.pid, process.guid, process.time, category]);
  return {
    entries,
    clear() { generation++; entries.clear(); },
    invalidate() { generation++; for (const entry of entries.values()) if (entry.status === "loading") entry.status = "idle"; },
    reset(process, category) { entries.delete(keyFor(process, category)); },
    get(process, category) { return entries.get(keyFor(process, category)); },
    async load(process, category) {
      const key = keyFor(process, category);
      let entry = entries.get(key);
      if (!entry) entries.set(key, entry = { key, process, category, facts: [], cursor: null, loaded: 0, rejected: 0, status: 'idle', collapsed: false, more: true });
      if (entry.status === 'loading' || !entry.more) return entry;
      const current = generation;
      entry.status = 'loading'; entry.error = '';
      try {
        const page = await fetchPage({ process: entry.process, category, cursor: entry.cursor, limit: OPERATION_PAGE_SIZE });
        if (current !== generation || entries.get(key) !== entry) return null;
        if (page.unsupported) { entry.status = 'unsupported'; entry.error = page.unsupported; entry.more = false; return entry; }
        if (!Number.isInteger(page.scanned) || page.scanned < 0 || page.scanned > OPERATION_PAGE_SIZE || !Array.isArray(page.facts) || page.facts.length > page.scanned) throw new Error('Нарушен контракт страницы операций');
        if (page.more && JSON.stringify(page.cursor) === JSON.stringify(entry.cursor)) throw new Error('API не продвинуло страницу');
        const ids = new Set(entry.facts.map(fact => fact.id));
        for (const fact of page.facts) {
          if (!fact.id || !fact.objectKey || !matchesOperation(fact, entry.process)) { entry.rejected++; continue; }
          if (!ids.has(fact.id)) { ids.add(fact.id); entry.facts.push(fact); }
        }
        entry.loaded += page.scanned;
        entry.rejected += page.scanned - page.facts.length;
        entry.cursor = page.cursor; entry.more = Boolean(page.more);
        entry.warning = page.warning || '';
        entry.status = entry.facts.length ? 'ready' : 'empty';
        return entry;
      } catch (error) {
        if (current !== generation || entries.get(key) !== entry) return null;
        entry.status = 'error'; entry.error = error.message;
        return entry;
      }
    },
  };
}
