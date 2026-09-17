import { exportFilterCatalog, importFilterCatalog, normalizeUserFilters } from "../filters/catalog.js";
import { TIME_RANGES } from "../filters/templates.js";

export function createFilterEditor({ root, builtins, normalize, dialect, onStatus = () => {},
  queryModes = [{ value: "where", label: "Условие поиска" }, { value: "sql", label: "Полный SQL-запрос" }], defaultMode = "where", prepareTemplate,
  queryHint = "Вставьте запрос. Подстановки полей события необязательны.",
}) {
  root.replaceChildren();
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const button = (text, action) => {
    const result = node("button", text); result.type = "button";
    result.addEventListener("click", async () => { try { await action(); } catch (error) { onStatus(error.message, true); } });
    return result;
  };
  root.append(node("h3", "Встроенные"), node("p", "Обновляются вместе с расширением. Для редактирования создайте пользовательскую копию. Снятая галочка скрывает фильтр."));
  const builtinList = node("div", "", "builtin-filter-list"); root.append(builtinList);
  const checks = new Map();
  root.append(node("h3", "Пользовательские"), node("p", "Создайте фильтр или импортируйте набор из файла. После изменений нажмите «Сохранить фильтры». При обновлении расширения ваши фильтры сохраняются."));
  const actions = node("div", "", "filter-actions"); root.append(actions);
  const empty = node("p", "Пока нет пользовательских фильтров. Нажмите «Создать фильтр» или скопируйте встроенный."); root.append(empty);
  const userList = node("div", "", "user-filter-list"); root.append(userList);
  let cards = [];
  const uniqueId = (base = "filter") => {
    const ids = new Set(cards.map(card => card.raw().id));
    let id = base.slice(0, 56), n = 2;
    while (ids.has(id)) id = `${base.slice(0, 56)}-${n++}`;
    return id;
  };
  const addCard = (filter, open = false) => {
    if (cards.length >= 100) throw new TypeError("Допускается не более 100 пользовательских фильтров");
    const details = node("details", "", "user-filter-card"); details.open = open;
    const summary = node("summary", filter.name || "Новый фильтр"); details.append(summary);
    const fields = {};
    const field = (key, title, tag = "input", choices) => {
      const label = node("label", title), input = node(tag);
      input.dataset.field = key;
      if (choices) for (const [value, text] of choices) { const option = node("option", text); option.value = value; input.append(option); }
      input.value = filter[key] ?? ""; fields[key] = input; label.append(input); details.append(label); return input;
    };
    const name = field("name", "Название"); name.maxLength = 120;
    name.addEventListener("input", () => { summary.textContent = name.value.trim() || "Новый фильтр"; });
    const description = field("description", "Описание", "textarea"); description.rows = 2; description.maxLength = 300;
    const mode = field("mode", "Тип запроса", "select", queryModes.map(item => [item.value, item.label]));
    if (filter.mode && !queryModes.some(item => item.value === filter.mode)) {
      const option = node("option", `Неподдерживаемый тип: ${filter.mode}`); option.value = filter.mode; mode.append(option);
    }
    mode.value = filter.mode || "where";
    if (mode.options.length === 1) mode.parentElement.hidden = true;
    field("timeRange", "Период вокруг события", "select", Object.keys(TIME_RANGES).map(value => [value, `±${{ "5m": "5 минут", "15m": "15 минут", "1h": "1 час", "24h": "24 часа", "7d": "7 дней", "30d": "30 дней" }[value]}`])).value = filter.timeRange || "15m";
    const platform = field("platform", "Для какой системы", "select", [["", "Любая, включая неизвестную"], ["windows", "Windows"], ["unix", "Unix / Linux"], ["windows,unix", "Windows и Unix / Linux"]]);
    platform.value = filter.platforms?.length === 2 ? "windows,unix" : filter.platforms?.[0] || "";
    const enabled = field("enabled", "Фильтр включён"); enabled.type = "checkbox"; enabled.checked = filter.enabled !== false;
    const template = field("template", "Запрос", "textarea"); template.rows = 18; template.spellcheck = false; template.className = "filter-query";
    details.append(node("p", queryHint, "hint"));
    const advanced = node("details"), advancedTitle = node("summary", "Дополнительно"); advanced.append(advancedTitle);
    const id = field("id", "Идентификатор (для импорта и экспорта)"); id.maxLength = 64;
    advanced.append(id.parentElement); details.append(advanced);
    const error = node("p", "", "filter-error"); error.setAttribute("role", "status");
    const preview = node("pre"); preview.hidden = true;
    const raw = () => ({ id: id.value, name: name.value, description: description.value, mode: mode.value || "where", timeRange: fields.timeRange.value,
      platforms: platform.value ? platform.value.split(",") : [], enabled: enabled.checked, template: template.value });
    const read = () => {
      try {
        const value = normalizeUserFilters([raw()], normalize)[0]; error.textContent = ""; return value;
      } catch (failure) { details.open = true; error.textContent = failure.message; throw failure; }
    };
    const card = { raw, read, details };
    const buttons = node("div", "", "filter-actions");
    buttons.append(button("Проверить шаблон", () => {
      const value = read();
      preview.hidden = !prepareTemplate;
      preview.textContent = prepareTemplate ? `Запрос перед подстановкой значений события:\n${prepareTemplate(value)}` : "";
      error.textContent = "Шаблон проверен. Окончательную проверку синтаксиса выполняет SIEM.";
    }), button("Удалить фильтр", () => {
      cards = cards.filter(item => item !== card); details.remove(); empty.hidden = cards.length > 0;
      onStatus("Фильтр удалён из формы. Нажмите «Сохранить фильтры», чтобы применить.");
    }));
    details.append(buttons, error, preview); userList.append(details); cards.push(card); empty.hidden = true;
    if (open) name.focus();
  };
  const readUsers = () => normalizeUserFilters(cards.map(card => card.read()), normalize);
  const setUsers = users => { cards = []; userList.replaceChildren(); for (const item of users) addCard(item); empty.hidden = users.length > 0; };
  for (const filter of builtins) {
    const details = node("details"), summary = node("summary"), label = node("label");
    const check = node("input"); check.type = "checkbox"; check.checked = true; checks.set(filter.id, check);
    label.append(check, document.createTextNode(` ${filter.name}`)); summary.append(label);
    const preview = node("pre", filter.template); preview.style.whiteSpace = "pre-wrap";
    details.append(summary, node("p", filter.description), preview, button("Создать пользовательскую копию", () => {
      addCard({ ...filter, id: uniqueId(`${filter.id}-copy`), name: `${filter.name} (копия)` }, true);
      onStatus("Копия добавлена. Отредактируйте её и нажмите «Сохранить фильтры».");
    }));
    builtinList.append(details);
  }
  const file = node("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
  file.addEventListener("change", async () => {
    try {
      const selected = file.files[0]; if (!selected) return;
      if (selected.size > 2 * 1024 * 1024) throw new TypeError("Файл фильтров превышает 2 МиБ");
      setUsers(importFilterCatalog(await selected.text(), readUsers(), { dialect, normalize }));
      onStatus("Фильтры добавлены. Нажмите «Сохранить фильтры».");
    } catch (error) { onStatus(error.message, true); } finally { file.value = ""; }
  });
  actions.append(button("Создать фильтр", () => addCard({ id: uniqueId(), name: "Новый фильтр", mode: defaultMode, template: "", enabled: true }, true)),
    button("Импорт JSON", () => file.click()), button("Экспорт JSON", () => {
      const url = URL.createObjectURL(new Blob([exportFilterCatalog(readUsers(), dialect)], { type: "application/json" }));
      const link = node("a"); link.href = url; link.download = `${dialect}-user-filters.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
  root.append(file);
  return {
    read: () => ({ userFilters: readUsers(), disabledBuiltinFilterIds: [...checks].filter(([, check]) => !check.checked).map(([id]) => id) }),
    set: ({ userFilters = [], disabledBuiltinFilterIds = [] }) => {
      setUsers(userFilters);
      for (const [id, check] of checks) check.checked = !disabledBuiltinFilterIds.includes(id);
    },
  };
}
