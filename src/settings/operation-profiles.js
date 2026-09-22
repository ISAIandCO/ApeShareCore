import { OPERATION_CATEGORIES } from '../graph/operations.js';
export const OPERATION_FIELDS = Object.freeze([
  ['name', 'Название профиля'], ['requirements', 'Источник, условия сбора и нормализации'], ['sourceField', 'Поле источника'], ['sourceValues', 'Значения источника (через запятую)'],
  ['eventField', 'Поле типа события'], ['eventValues', 'Типы / Event ID (через запятую)'],
  ['operationField', 'Дополнительное поле операции (например, имя syscall)'], ['operationValues', 'Значения операции (через запятую)'],
  ['host', 'Поле хоста'], ['pid', 'PID инициатора'], ['guid', 'GUID инициатора (если есть)'],
  ['target', 'Целевой объект / путь / адрес'], ['targetPort', 'Порт цели (необязательно)'],
  ['targetPid', 'PID / GUID целевого процесса (необязательно)'], ['protocol', 'Протокол (необязательно)'],
  ['action', 'Поле действия / маски доступа (необязательно)'], ['outcome', 'Поле результата (необязательно)'],
  ['targetDetail', 'Часть объекта: значение реестра (необязательно)'], ['recordId', 'Уникальный ID события'], ['time', 'Время события'],
]);
const fields = new Set(['sourceField', 'eventField', 'operationField', 'host', 'pid', 'guid', 'target', 'targetPort', 'targetPid', 'protocol', 'action', 'outcome', 'targetDetail', 'recordId', 'time']);
const required = new Set(['name', 'sourceField', 'sourceValues', 'eventField', 'eventValues', 'host', 'pid', 'target', 'recordId', 'time']);
export function normalizeOperationProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length > 50) throw new Error('Допустимо до 50 профилей операций');
  const ids = new Set();
  return profiles.map(profile => {
    if (!profile || !/^[\w-]{1,100}$/.test(profile.id) || ids.has(profile.id)) throw new Error('Некорректный или повторный ID профиля');
    ids.add(profile.id);
    if (!OPERATION_CATEGORIES[profile.category] || !['windows', 'unix'].includes(profile.platform)) throw new Error('Выберите категорию и ОС');
    if (profile.pidFormat && !['auto', 'number', 'text'].includes(profile.pidFormat)) throw new Error('Неизвестный формат PID');
    const result = { id: profile.id, category: profile.category, platform: profile.platform, enabled: Boolean(profile.enabled), pidFormat: profile.pidFormat || 'auto', selectorRequired: Boolean(profile.selectorRequired) };
    for (const [key, label] of OPERATION_FIELDS) {
      const value = String(profile[key] ?? '').trim();
      if ((result.enabled && required.has(key) && !value) || value.length > 500) throw new Error(`${profile.name || profile.id || 'Новый профиль'}: проверьте «${label}»`);
      if (fields.has(key) && value && !/^[A-Za-z_][\w.]*$/.test(value)) throw new Error(`${label}: недопустимое имя поля`);
      result[key] = value;
    }
    if (result.enabled && result.selectorRequired && !result.operationField) throw new Error(`${result.name || result.id}: укажите поле типа объекта / имени syscall`);
    if ((result.enabled || result.operationField) && Boolean(result.operationField) !== Boolean(result.operationValues)) throw new Error('Задайте и поле, и значения операции');
    if (result.enabled && ['sourceValues', 'eventValues', ...(result.operationField ? ['operationValues'] : [])].some(key => !profileValues(result[key]).length)) throw new Error('Список признаков события пуст');
    if (result.category === 'registry' && result.platform !== 'windows') throw new Error('Реестр доступен только в Windows');
    return result;
  });
}
// Absence means first installation, whereas [] means the user's explicit choice.
// Existing profiles are never replaced with later recommended values.
export function migrateOperationProfiles(saved, defaults) {
  if (saved === undefined || saved === null) return { version: 1, profiles: normalizeOperationProfiles(defaults) };
  if (Array.isArray(saved)) return { version: 1, profiles: normalizeOperationProfiles(saved) };
  if (saved.version !== 1) throw new Error('Неподдерживаемая версия профилей операций');
  return { version: 1, profiles: normalizeOperationProfiles(saved.profiles) };
}
export function profileValues(value) { return String(value).split(',').map(item => item.trim()).filter(Boolean); }
export function operationFact(event, profile, read, parseTime) {
  const get = key => profile[key] ? read(event, profile[key]) : '';
  if (!profileValues(profile.sourceValues).includes(String(get('sourceField'))) || !profileValues(profile.eventValues).includes(String(get('eventField')))) return null;
  if (profile.operationField && !profileValues(profile.operationValues).includes(String(get('operationField')))) return null;
  const target = String(get('target') ?? '').trim();
  if (!target || target === '-' || (profile.platform === 'unix' && profile.category === 'access' && /^(0x0+|0+|-1)$/.test(target))) return null;
  const port = get('targetPort'), pid = get('targetPid'), protocol = get('protocol'), detail = get('targetDetail');
  return { id: String(get('recordId') ?? ''), host: String(get('host') ?? ''), pid: get('pid'), guid: get('guid'),
    time: parseTime(get('time')), objectKey: target ? JSON.stringify([target, port, pid, protocol, detail]) : '',
    label: [target, detail, port && `порт ${port}`, pid && `PID ${pid}`, protocol].filter(Boolean).join(' · '),
    operation: [get('eventField'), get('operationField'), get('action'), get('outcome')].filter(value => value !== '' && value != null).join(' · '), raw: event, profile: profile.name, recordField: profile.recordId, timeField: profile.time };
}
