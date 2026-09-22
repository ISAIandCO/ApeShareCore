import { operationFact, profileValues } from '../settings/operation-profiles.js';
// Dialect/API primitives belong to the consumer. A category page shares one
// raw-event budget across its source profiles, including rejected records.
export async function searchOperationPage({ process, category, cursor, profiles, dialect, fetch, read, parseTime, isFact = () => true }) {
  const applicable = profiles.filter(p => p.enabled && p.category === category && p.platform === process.platform);
  if (!applicable.length) return { unsupported: 'Нет включённого профиля для этой категории и ОС. Проверьте источник и сопоставления в настройках.' };
  const signature = JSON.stringify(applicable);
  if (cursor && cursor.signature !== signature) throw new Error('Настройки изменились. Перезагрузите граф перед продолжением');
  let index = cursor?.profile ?? 0, offset = cursor?.offset ?? 0;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || index < 0 || index >= applicable.length || offset < 0 || offset > 100000) throw new Error('Некорректная страница операций');
  const facts = [];
  let scanned = 0, pidFallback = false;
  while (index < applicable.length && scanned < 25) {
    const profile = applicable[index];
    const guid = Boolean(process.guid && profile.guid);
    if (!guid && !process.pid) return { unsupported: 'В выбранном процессе отсутствует PID для этого профиля' };
    pidFallback ||= !guid;
    const where = dialect.and([
      dialect.in(profile.sourceField, profileValues(profile.sourceValues)),
      dialect.in(profile.eventField, profileValues(profile.eventValues)),
      dialect.equal(profile.host, process.host),
      guid ? dialect.guid(profile.guid, process.guid) : dialect.pid(profile.pid, process.pid, profile.pidFormat),
      ...(profile.operationField ? [dialect.in(profile.operationField, profileValues(profile.operationValues))] : []),
      dialect.factual,
    ]);
    const limit = 25 - scanned;
    const records = await fetch({ where, profile, offset, limit, from: process.from, to: process.to });
    if (!Array.isArray(records) || records.length > limit) throw new Error('API вернуло некорректную страницу операций');
    scanned += records.length;
    facts.push(...records.filter(isFact).map(event => operationFact(event, profile, read, parseTime)).filter(fact => fact && (!guid || fact.guid)));
    if (records.length < limit) { index++; offset = 0; }
    else offset += records.length;
  }
  return { facts, scanned, cursor: { profile: index, offset, signature }, more: index < applicable.length,
    warning: pidFallback ? 'Сопоставление по PID, хосту и времени; повторное использование PID вне известных графу запусков не исключено.' : '' };
}

// Windows Security can retain a pointer PID as a padded hex string. Enumerate
// representations without dialect-specific casts or architecture-specific IDs.
export function pidTextValues(value) {
  if (!/^\d+$/.test(String(value))) return [String(value)];
  const decimal = BigInt(value).toString(), hex = BigInt(value).toString(16);
  const values = new Set([decimal]);
  for (let width = 1; width <= 16; width++) {
    values.add(decimal.padStart(width, '0'));
    for (const prefix of ['0x', '0X']) {
      values.add(prefix + hex.padStart(width, '0'));
      values.add(prefix + hex.toUpperCase().padStart(width, '0'));
    }
  }
  return [...values];
}
