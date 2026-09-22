# Changelog

## 1.6.0

- Общий каталог Windows Security / Linux auditd, обязательные селекторы типа объекта/syscall, поля результата и части объекта, строковые PID с ведущими нулями. Профили источников делят бюджет 25 событий за одно нажатие.

- Общая модель операций процесса, группировка объектов, независимые страницы по 25 событий, защита от повторных и устаревших ответов.
- Общие узлы категорий/объектов, сворачивание, карточки исходных событий и редактор профилей с миграцией.

## 1.5.0

- Shared form-based filter editor with create, copy, delete, validation and optional query preview.
- Preserve multiline templates; JSON remains available for import/export.

## 1.4.0

- Shared built-in/user filter catalog migration, composition, validation, JSON import/export and editor.

## 1.3.1

- Preserve the source event when another event shares its PID. PID reuse or exec no longer silently replaces the selected source; GUID evidence can still share a node.

## 1.2.0

- Все поверхности AI используют общий контроллер диалога: предпросмотр, подтверждение, защита от повторной отправки, сохранение ответа и обработка поздних результатов. Нормализация ответов и tool calls также общая.
- Сохранение и восстановление графов вынесено в `graph/snapshots`, включая проверку схемы и ограничение числа/размера снимков.
- AI-вложения больше не обрезают длинные текстовые поля по лимитам карточек расследования.

- Общие workflow и UI графов, модель и хранилище расследований, AI payload/privacy, ссылки и пакетные проверки IOC, шаблоны фильтров и профили настроек.
- Добавлены проверки параллельного хранения, PID/GUID, отмены и независимости от DOM при импорте.

## 1.1.0

- Добавлена общая компактизация AI-контекста: текстовая история сохраняется, повторные вложения передаются одним набором с лимитом 2 MiB.

## 1.0.1

- Увеличено стандартное ожидание локального AI до 15 минут; значение экспортировано как `AI_RESPONSE_TIMEOUT_MS`.

## 1.0.0

- Автономные модули IOC backend/UI/batch, AI transport/chat, investigation model, event comparison, graph, Markdown и values.
- Публичные subpath exports и контракты с сохранением существующих моделей ApePatrol.
- Контрактные тесты, проверка границ модулей, CI пакета и подключённых потребителей.
- Нет runtime-зависимостей, хранилищ, SIEM DOM/API, доступа к ключам или автоматических запросов при импорте.
