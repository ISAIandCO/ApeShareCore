import { operationFact, profileValues } from '../settings/operation-profiles.js';
// Dialect/API primitives belong to the consumer. This module only plans one
// bounded page and normalizes facts; it cannot access SIEM or global settings.
export async function searchOperationPage({ process, category, cursor, profiles, dialect, fetch, read, parseTime, isFact = () => true }) {
  const applicable = profiles.filter(p => p.enabled && p.category === category && p.platform === process.platform);
  if (!applicable.length) return { unsupported: 'Нет включённого профиля для этой категории и ОС. Проверьте источник и сопоставления в настройках.' };
  const signature = JSON.stringify(applicable);
  if (cursor && cursor.signature !== signature) throw new Error('Настройки изменились. Перезагрузите граф перед продолжением');
  const index = cursor?.profile ?? 0, offset = cursor?.offset ?? 0;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || index < 0 || index >= applicable.length || offset < 0 || offset > 100000) throw new Error('Некорректная страница операций');
  const profile = applicable[index];
  const guid = Boolean(process.guid && profile.guid);
  if (!guid && !process.pid) return { unsupported: 'В выбранном процессе отсутствует PID для этого профиля' };
  const where = dialect.and([
    dialect.in(profile.sourceField, profileValues(profile.sourceValues)),
    dialect.in(profile.eventField, profileValues(profile.eventValues)),
    dialect.equal(profile.host, process.host),
    guid ? dialect.guid(profile.guid, process.guid) : dialect.pid(profile.pid, process.pid),
    ...(profile.operationField ? [dialect.in(profile.operationField, profileValues(profile.operationValues))] : []),
    dialect.factual,
  ]);
  const records = await fetch({ where, profile, offset, limit: 25, from: process.from, to: process.to });
  if (!Array.isArray(records) || records.length > 25) throw new Error('API вернуло некорректную страницу операций');
  const nextProfile = records.length < 25;
  const next = nextProfile ? { profile: index + 1, offset: 0 } : { profile: index, offset: offset + records.length };
  return { facts: records.filter(isFact).map(event => operationFact(event, profile, read, parseTime)).filter(Boolean), scanned: records.length,
    cursor: { ...next, signature }, more: !nextProfile || next.profile < applicable.length,
    warning: guid ? '' : 'Сопоставление по PID, хосту и времени; повторное использование PID вне известных графу запусков не исключено.' };
}
