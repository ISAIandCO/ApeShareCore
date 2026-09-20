import { OPERATION_CATEGORIES } from '../graph/operations.js';
import { OPERATION_FIELDS, migrateOperationProfiles, normalizeOperationProfiles } from '../settings/operation-profiles.js';
export function createOperationProfileEditor({ root, defaults, save, status = () => {} }) {
  const doc = root.ownerDocument;
  let cards = [];
  const list = doc.createElement('div');
  const button = (label, action) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b; };
  function add(profile) {
    const card = doc.createElement('details');
    const summary = doc.createElement('summary'); summary.textContent = profile.name || 'Новый профиль'; card.append(summary);
    const inputs = {};
    const control = (key, title, options) => {
      const label = doc.createElement('label'); label.textContent = title + ' ';
      const input = doc.createElement(options ? 'select' : 'input');
      if (options) for (const [value, text] of options) { const option = doc.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
      input.value = profile[key] ?? ''; input.dataset.operationField = key;
      const recommended = defaults.find(item => item.id === profile.id)?.[key];
      if (recommended) input.title = `Рекомендовано: ${recommended}`;
      label.append(input); card.append(label, doc.createElement('br')); inputs[key] = input;
    };
    const enabled = doc.createElement('input'); enabled.type = 'checkbox'; enabled.checked = profile.enabled;
    const enabledLabel = doc.createElement('label'); enabledLabel.append(enabled, ' Использовать профиль (после проверки нормализации)'); card.append(enabledLabel);
    control('category', 'Категория', Object.entries(OPERATION_CATEGORIES));
    control('platform', 'ОС', [['windows', 'Windows'], ['unix', 'Linux / Unix']]);
    for (const [key, title] of OPERATION_FIELDS) control(key, title);
    const item = { card, read: () => ({ id: profile.id, enabled: enabled.checked, ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])) }) };
    card.append(button('Удалить профиль', () => { cards = cards.filter(other => other !== item); card.remove(); }));
    cards.push(item); list.append(card);
  }
  const hint = doc.createElement('p'); hint.textContent = 'Профиль задаёт и запрос, и разбор события. PID — только инициатор, не родитель и не цель. Одинаковые типы разных источников настраиваются отдельно. Пустые необязательные поля не используются. Рекомендуемые значения видны в подсказках. Изменения действуют после сохранения и повторной загрузки графа.';
  root.append(hint, list,
    button('Добавить профиль', () => add({ id: doc.defaultView.crypto.randomUUID(), category: 'files', platform: 'windows' })),
    button('Сбросить к рекомендованным', () => set(undefined)),
    button('Сохранить профили операций', async () => { try { await save(get()); status('Профили операций сохранены'); } catch (error) { status(error.message, true); } }));
  function set(value) { cards = []; list.replaceChildren(); for (const profile of migrateOperationProfiles(value, defaults).profiles) add(profile); }
  function get() { return { version: 1, profiles: normalizeOperationProfiles(cards.map(item => item.read())) }; }
  return { set, get };
}
