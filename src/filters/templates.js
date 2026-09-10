export const TIME_RANGES = Object.freeze({ "5m": 300, "15m": 900, "1h": 3600, "24h": 86400, "7d": 604800, "30d": 2592000 });
export function requiredTemplateFields(template, pattern = /\$\{(@?[A-Za-z_][A-Za-z0-9_.]*)\}/g) {
  return [...new Set([...String(template).matchAll(pattern)].map(match => match[1]))];
}
export function renderTemplate(template, { pattern, renderPattern = pattern, resolve, missingLabel = field => field, render }) {
  const fields = requiredTemplateFields(template, pattern);
  const values = new Map(fields.map(field => [field, resolve(field)]));
  const missing = fields.filter(field => values.get(field) === undefined || values.get(field) === null || values.get(field) === "").map(missingLabel);
  if (missing.length) return { ok: false, missing, query: null };
  const query = String(template).replace(renderPattern, (...args) => render(values, ...args));
  return { ok: true, missing: [], query };
}
