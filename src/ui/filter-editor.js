import { exportFilterCatalog, importFilterCatalog, normalizeUserFilters } from "../filters/catalog.js";

export function createFilterEditor({ root, builtins, normalize, dialect, onStatus = () => {} }) {
  root.replaceChildren();
  const heading = text => { const node = document.createElement("h3"); node.textContent = text; root.append(node); };
  const hint = text => { const node = document.createElement("p"); node.textContent = text; root.append(node); };
  const button = (text, action) => {
    const node = document.createElement("button"); node.type = "button"; node.textContent = text;
    node.addEventListener("click", async () => { try { await action(); } catch (error) { onStatus(error.message, true); } });
    return node;
  };
  heading("Встроенные");
  hint("Обновляются вместе с расширением. Для редактирования создайте пользовательскую копию. Снятая галочка скрывает фильтр.");
  const builtinList = document.createElement("div"); root.append(builtinList);
  const checks = new Map();
  heading("Пользовательские");
  hint("Сохраняются при обновлении. JSON-массив шаблонов; импорт добавляет записи без замены существующих. После редактирования или импорта нажмите «Сохранить фильтры».");
  const textarea = document.createElement("textarea"); textarea.rows = 18; textarea.spellcheck = false;
  textarea.setAttribute("aria-label", "Пользовательские фильтры (JSON)"); textarea.style.width = "100%"; root.append(textarea);
  const readUsers = () => normalizeUserFilters(JSON.parse(textarea.value || "[]"), normalize);
  for (const filter of builtins) {
    const details = document.createElement("details"), summary = document.createElement("summary"), label = document.createElement("label");
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = true; checks.set(filter.id, check);
    label.append(check, document.createTextNode(` ${filter.name}`)); summary.append(label);
    const description = document.createElement("p"); description.textContent = filter.description;
    const preview = document.createElement("pre"); preview.textContent = filter.template; preview.style.whiteSpace = "pre-wrap";
    details.append(summary, description, preview, button("Создать пользовательскую копию", () => {
      const users = readUsers(); let id = `${filter.id}-copy`, suffix = 2;
      while (users.some(item => item.id === id)) id = `${filter.id}-copy-${suffix++}`;
      textarea.value = JSON.stringify(normalizeUserFilters([...users, { ...filter, id, name: `${filter.name} (копия)` }], normalize), null, 2);
      onStatus("Копия добавлена. Нажмите «Сохранить фильтры».");
    }));
    builtinList.append(details);
  }
  const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.hidden = true;
  file.addEventListener("change", async () => {
    try {
      const selected = file.files[0]; if (!selected) return;
      if (selected.size > 2 * 1024 * 1024) throw new TypeError("Файл фильтров превышает 2 МиБ");
      textarea.value = JSON.stringify(importFilterCatalog(await selected.text(), readUsers(), { dialect, normalize }), null, 2);
      onStatus("Фильтры добавлены. Нажмите «Сохранить фильтры».");
    } catch (error) { onStatus(error.message, true); } finally { file.value = ""; }
  });
  root.append(file, button("Импорт JSON", () => file.click()), button("Экспорт JSON", () => {
    const url = URL.createObjectURL(new Blob([exportFilterCatalog(readUsers(), dialect)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${dialect}-user-filters.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  return {
    read: () => ({ userFilters: readUsers(), disabledBuiltinFilterIds: [...checks].filter(([, check]) => !check.checked).map(([id]) => id) }),
    set: ({ userFilters = [], disabledBuiltinFilterIds = [] }) => {
      textarea.value = JSON.stringify(userFilters, null, 2);
      for (const [id, check] of checks) check.checked = !disabledBuiltinFilterIds.includes(id);
    },
  };
}
