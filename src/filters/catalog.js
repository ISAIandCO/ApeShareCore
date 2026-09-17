// The caller owns persistence and dialect validation. Never persist the composed catalog.
export function splitLegacyFilters(legacy = [], builtins = []) {
  const byId = new Map(builtins.map(item => [item.id, item]));
  const userFilters = [], disabledBuiltinFilterIds = [];
  for (const item of legacy) {
    const builtin = byId.get(item.id);
    if (builtin && item.enabled === false) disabledBuiltinFilterIds.push(item.id);
    const changed = !builtin || ["template", "name", "description", "timeRange", "mode", "platforms"].some(key =>
      item[key] !== undefined && JSON.stringify(item[key]) !== JSON.stringify(builtin[key] ?? (key === "platforms" ? [] : key === "mode" ? "where" : undefined)));
    if (changed) {
      userFilters.push({ ...item });
      if (builtin && !disabledBuiltinFilterIds.includes(item.id)) disabledBuiltinFilterIds.push(item.id);
    }
  }
  return { userFilters, disabledBuiltinFilterIds };
}

export function composeFilterCatalog(builtins, userFilters = [], disabledBuiltinFilterIds = []) {
  const disabled = new Set(disabledBuiltinFilterIds);
  return [
    ...builtins.map(item => ({ ...item, source: "builtin", enabled: item.enabled !== false && !disabled.has(item.id) })),
    ...userFilters.map(item => ({ ...item, id: `user:${item.id}`, source: "user" })),
  ];
}

export function normalizeUserFilters(input, normalize, maxCount = 100) {
  if (!Array.isArray(input) || input.length > maxCount) throw new TypeError(`Ожидается массив не более чем из ${maxCount} фильтров`);
  const ids = new Set();
  return input.map((item, index) => {
    const normalized = normalize(item, index);
    if (!normalized) throw new TypeError(`Фильтр ${index + 1}: недопустимый шаблон`);
    if (ids.has(normalized.id)) throw new TypeError(`Повторяется id полезного фильтра: ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
}

export function importFilterCatalog(text, current, { dialect, normalize }) {
  if (text.length > 2 * 1024 * 1024) throw new TypeError("Файл фильтров превышает 2 МиБ");
  const data = JSON.parse(text);
  if (!Array.isArray(data) && (data?.kind !== "ape-useful-filters" || data.version !== 1 || data.dialect !== dialect)) {
    throw new TypeError("Неверный формат или язык файла фильтров");
  }
  const incoming = normalizeUserFilters(Array.isArray(data) ? data : data.filters, normalize);
  const merged = new Map(normalizeUserFilters(current, normalize).map(item => [item.id, item]));
  for (const item of incoming) {
    if (merged.has(item.id)) throw new TypeError(`Фильтр ${item.id} уже существует. Измените id перед импортом`);
    merged.set(item.id, item);
  }
  return normalizeUserFilters([...merged.values()], normalize);
}

export function exportFilterCatalog(filters, dialect) {
  return JSON.stringify({ kind: "ape-useful-filters", version: 1, dialect, filters }, null, 2);
}
