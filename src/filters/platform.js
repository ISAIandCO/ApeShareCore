// SIEM adapters supply evidence; the core never reads vendor-specific fields.
export function detectEventPlatform({ os = [], source = [], paths = [] } = {}) {
  const classify = (values) => {
    const text = values.filter(value => typeof value === "string").join(" ");
    const windows = /\bwindows\b|\bwin32\b|\bwin64\b/i.test(text);
    const unix = /\b(?:linux|unix|ubuntu|debian|centos|rhel|red hat|astra|alt linux|freebsd|openbsd|darwin|macos|aix|solaris|auditd)\b/i.test(text);
    return windows && unix ? "conflict" : windows ? "windows" : unix ? "unix" : null;
  };
  const explicit = classify(os);
  if (explicit) return explicit === "conflict" ? "unknown" : explicit;
  const product = classify(source);
  if (product) return product === "conflict" ? "unknown" : product;
  const windows = paths.some(value => /^(?:[a-z]:\\|\\\\|HKEY_|HK(?:LM|CU|CR|U|CC)\\|\\REGISTRY\\)/i.test(String(value)));
  const unix = paths.some(value => /^\/(?!\/)/.test(String(value)));
  return windows === unix ? "unknown" : windows ? "windows" : "unix";
}

export function normalizeFilterPlatforms(platforms) {
  return Array.isArray(platforms) ? [...new Set(platforms.filter(value => ["windows", "unix"].includes(value)))] : [];
}

export function filterSupportsPlatform(filter, platform) {
  const platforms = normalizeFilterPlatforms(filter.platforms);
  return !platforms.length || platforms.includes(platform);
}
