# Публичные контракты 1.x

Публичны только пути из `package.json#exports`. Структура `src/` — деталь реализации. Приложения не импортируют внутренние файлы напрямую. Добавление совместимой возможности — minor, исправление с сохранением контрактов — patch, несовместимое изменение — major.

## IOC: данные и HTTP

`lookupIoc(providerId, {type, value}, secrets, {fetchImpl, signal})` возвращает Promise объекта `{provider, verdict, summary, details, type, value}`. `type`: `ip`, `hash`, `domain`, `url`. Названия секретов находятся в каталоге `IOC_API_PROVIDERS`; приложение преобразует своё хранилище в этот объект. Чтения хранилища и проверки Firefox permissions внутри модуля нет.

Вердикты: `malicious`, `suspicious`, `clean-or-unknown`. Последний не означает доказанную безопасность. Клиенты используют только операции поиска отчётов (в том числе POST поиска ThreatFox), без отправки файлов и создания отчётов. HTTP-побочный эффект происходит только при вызове; возможна подстановка `fetchImpl`. Cookies не отправляются, redirect запрещён. Таймаут 20 секунд включает чтение ответа.

`ProviderError` сохраняет `code`, `status` и `retryAfterMs`. Ошибки аутентификации: `PROVIDER_AUTH_FAILED`, ограничения: `PROVIDER_RATE_LIMIT`, HTTP-недоступность: `PROVIDER_UNAVAILABLE`, неверная структура известного отчёта: `PROVIDER_INVALID_RESPONSE`. Невалидный JSON, отмена и ошибки сети также отклоняют Promise; текст исключения не является машинным контрактом. Продукт может отдельно отображать HTTP 404 как отсутствие отчёта.

## IOC: интерфейс

`iocActions(ioc, providers?)` — чистое преобразование в список `{id, name, ioc}`.

`mountIocActions(container, options)` создаёт кнопки и возвращает `{buttons, destroy}`. Обязательны `lookup(providerId, ioc)` и `onResult(result, action)`. Опциональны `onError`, `onSettled`, `labelFor`, `pendingFor`, `providers`, `requireTrusted`, `addButton`.

По умолчанию используется только `container.ownerDocument`; глобальные DOM-объекты не читаются. `addButton(label, asyncHandler)` должен вернуть кнопку и вызвать `asyncHandler(button)` после принятого клика. Это адаптер оформления и правил клика, а не сетевой клиент. Кнопка блокируется на время запроса и восстанавливается при успехе или ошибке. Повторный запуск занятой кнопки игнорируется. После `destroy()` новые запросы и доставка результата прекращаются. Уже начатую сеть отменяет переданный приложением lookup/AbortSignal. Элементы, созданные custom addButton, принадлежат приложению; оно удаляет свой контейнер самостоятельно.

## AI

`chatEndpoint(value, {expandBase})` возвращает проверенный URL. По умолчанию путь сохраняется полностью; режим `expandBase` дополнит `/` или `/v1` до chat/completions. Политику доступных хостов определяет приложение.

`requestChatCompletion(endpoint, serialized, {apiKey, timeoutMs, fetchImpl, signal})` отправляет **ровно** переданный serialized payload и возвращает объект message из OpenAI-совместимого ответа. Preview/подтверждение, модель и инструменты задаются приложением. Ключ необязателен. Таймаут по умолчанию 15 минут (`AI_RESPONSE_TIMEOUT_MS`), отмена и чтение body включены. Разрешённые tool calls проверяет приложение по своему набору инструментов.

`ai/chat` принимает и возвращает обычные объекты диалога. Сохранены ограничения модели ApePatrol: 80 сообщений, 8 вложений, 2 MiB на диалог и контекст, draft и pending tool calls. Нормализация может отбрасывать некорректные элементы, повторные вложения с одинаковыми `type`/`value` и старые сообщения при превышении лимитов. `compactAiConversation` отделяет полную текстовую историю от единственного набора уникальных вложений; `compactAiContextItems` предоставляет ту же операцию для SIEM-специфичных адаптеров. Исходный объект не изменяется. UUID и время генерируются стандартными API при отсутствии заданных значений. Преобразование сырых полей SIEM в attachment остаётся адаптером приложения.

## Расследования и сравнение

`investigation/model` сохраняет schemaVersion 1 и поля существующей модели ApePatrol, включая sourceEventUuid как непрозрачный идентификатор происхождения. `createWorkspace`, `normalizeWorkspace`, `addWorkspaceItem` работают с переданными объектами и возвращают новые; глобальное состояние и persistence отсутствуют. Типы объектов: event, process, ioc, host, account, incident, note. Лимиты: 500 объектов, 1 MiB на объект, 20 MiB на расследование. Существующая фильтрация секретных полей snapshot сохранена.

`compareEvents(events, {normalizeField, fieldGroup})` сравнивает 2–3 объекта и возвращает `{eventCount, rows, groups}`. Статусы строк: same, changed, only. Группировка полей SIEM передаётся функцией; стандартные группы вывода Markdown — process/network/account/host/rule/raw. Нормализаторы и экспорт не изменяют входные события.

## Граф и Markdown

Физика работает только с переданными узлами. `applyRepulsion`, `seedComponentLayout`, `stabilizeForceNode` **изменяют координаты/скорости переданных узлов** — это существующий контракт, необходимый для производительности. Они не читают DOM, не сохраняют граф и не запускают цикл анимации. `ProcessSpatialIndex` хранит состояние только своего экземпляра.

Markdown renderer меняет только переданный контейнер или создаёт fragment через переданный document. Он не исполняет HTML из входного текста. CSS, компоновка и жизненный цикл окна принадлежат приложению.

## Batch и значения

`ioc/batch` принимает задания, результаты и объект кеша; возвращает задания, нормализованные результаты, ключи и отфильтрованные копии. Сам модуль не делает запросов, не ждёт ретраев и не пишет в хранилище. Ключи существующего кеша ApePatrol сохранены. Планировщик и лимиты параллельности реализованы в `ioc/runner`; доступ к persistence передаётся адаптером.

Модули `values/*` и `ioc/normalize` принимают значения и возвращают нормализованное значение, null или категорию. В них нет сетевых и файловых операций.

## Общие процессы (1.2)

`graph/process-model` принимает факты `{raw, recordId, host, time, identity, references, parentRefs}`. `time` — миллисекунды Unix; `identity` — `{id, kind, value}`, ссылки — `{kind: "guid" | "pid", value}`. Адаптер выбирает поля и нормализует регистр/формат идентификаторов. PID сопоставляется внутри хоста с ближайшим предшествующим временем жизни; GUID имеет приоритет. `raw` не изменяется. Узел содержит исходное `event`, нормализованные `fact` без повторной копии raw и `evidence` для событий, объединённых одним идентификатором процесса.

`createProcessWorkflow({origin, normalize, searchPage}, settings)` возвращает `load(event, mode, signal)`, `expand(event, message, signal)` и `expandNode(event, message, signal)`. Общими являются пагинация, устранение повторов, сохранение исходного процесса, два прохода пошагового поиска, выбор связанных узлов, увеличение лимита и продолжение диапазонов. Настройки: `process.{maxNodes,maxDepth,pageSize,queryConcurrency,seedWindowSeconds,expansionStepSeconds}` и `searchScope.mode`.

`searchPage` получает `{where, timeFrom, timeTo, offset, limit, signal}`. Диапазоны — **ISO UTC**, `offset` — число ранее прочитанных записей. `where` — намерение `{kind:"processes",host}` либо `{kind:"relations",events,direction}`. SQL/PDQL здесь отсутствуют. Адаптер переводит намерение в допустимый запрос SIEM и возвращает `{events, exhausted?, limitReached?}`. Для API без OFFSET адаптер может нарезать ограниченный ответ локально, но обязан отмечать серверный предел: окончание локального массива не доказывает полноту данных на сервере. При отмене адаптер передаёт signal транспортному запросу; поздние ответы не применяются.

`graph/filters` работает с `node.filterValues` (`name,path,account,pid,host,eventType`) и исходным `node.event`. Фильтр текста/regex и обход родственников не знают названий SIEM-полей. Циклические входные графы не вызывают бесконечный обход.

## Общие страницы и хранилища (1.2)

`mountProcessGraph(root, adapter)` и `mountWorkspace(root, adapter)` создают контроллеры внутри переданного Document/Element. Импорт не требует DOM. Обработчики, observers и анимация снимаются через `destroy()`. `mountWorkspace` также возвращает `ready`, `state`, `refresh` и `selectWorkspace`; граф возвращает `state`, `reload`, `applyGraphResponse`. Это UI-модули с явными побочными эффектами только после монтирования.

Адаптер графа предоставляет `buildView,isAvailable,load,expand,expandNode,cancel,open,pin,openWorkspace`. Необязательны `loadSnapshot,saveSnapshot,reconnect,subscribeUnavailable,loadForceSettings,saveForceSettings`; `subscribeUnavailable` возвращает функцию отписки. Ответ загрузки содержит `graph,sourceEvent,sourceNodeId,origin,queryMetadata`. Представление узла содержит подпись, детали карточки, время, размер и `filterValues`.

Адаптер расследования предоставляет `request`, `buildInvestigationGraph`, `describeInvestigationEvent`, `eventTime`, `eventIdentity`, `eventItem`, `canSearch`, `canOpenEvent`, `openEvent`, `searchEntities`, `requestAiCompletion`, экспорт и download. `request` реализует операции `workspace:list/create/update/delete/item:add/item:remove/chat:get/chat:save`, `settings:get`, `ai:preview` и отклоняет Promise при ошибке. `searchEntities` возвращает `{events,query?}`. Монтирование загружает локальные расследования; поиск SIEM и отправка AI выполняются по действиям оператора. При переключении расследования поздний AI-ответ сохраняется в исходном диалоге.

HTML/CSS страниц находятся в `templates/*` и `styles/*`. Сборщик подставляет только название продукта, относительные пути и entry script. Копии HTML в потребителях служат исходными оболочками; в артефакт всегда попадает шаблон установленного ядра.

`createInvestigationRepository({databaseFactory,name,version?})` получает фабрику доступа к IndexedDB от приложения. Общая схема: stores `workspaces` и `aiChats`. Модель расследования расширена статусом `open|closed`, отсутствующий статус — `open`. Сохранение объектов выполняется в одной readwrite-транзакции с чтением, поэтому параллельные добавления из разных страниц не теряются. Миграция посторонних схем не выполняется. `createRecordStorage` аналогично предоставляет `get/set/remove/clear` для крупных локальных снимков. Сам импорт соединений не открывает.

## Остальные общие блоки (1.2)

- `events/describe` строит описание из семантических полей; `investigation/graph` объединяет события через нормализованные сущности. Списки SIEM-полей передаются адаптерами.
- `ai/payload` формирует и ограничивает тело запроса, считает UTF-8 размер и SHA-256 для сверки с предпросмотром; `ai/privacy` выбирает поля, редактирует чувствительные значения и устраняет повторный контекст. Политика доступных хостов, credentials и названия полей остаются у потребителя.
- `ui/chat-messages` — единый Markdown/attachments renderer. `ui/download` создаёт Blob URL и безопасное имя файла; получает функцию скачивания от приложения.
- `ioc/report-links` — каталог и построение ссылок на существующие отчёты. `ioc/runner` — подтверждённые пакетные проверки, ограничение параллелизма, повторение временных ошибок, отмена и кеш; storage, permissions, secrets и настройки инъецируются.
- `filters/templates` — поиск обязательных placeholders и подстановка. Проверка допустимых полей и экранирование литералов зависят от SQL/PDQL и передаются callback-функциями.
- `settings/profiles` — чистое объединение управляемых настроек и импорт/экспорт профиля. Продукт задаёт defaults, normalize и идентификатор формата.

## Диалоги и снимки графа

`createAiConversation({read,write,scope,request,preview,complete,persist,changed})` управляет диалогом независимо от его размещения. `preview()` запоминает точный запрос и результат локальной подготовки. `invalidate()` отменяет актуальность предпросмотра, включая ещё выполняющиеся операции. `send({confirmed:true})` передаёт `previewHash` и `previewEndpoint` в адаптер отправки; адаптер повторно проверяет настройки, адрес, тело, разрешения и ключ. На один scope допускается одна отправка. Ответ сохраняется в исходном scope; переключение или `destroy()` запрещает менять другой/уничтоженный интерфейс, но не теряет уже начатую запись ответа. Ошибки сети или записи не очищают исходный черновик.

`normalizeAiResponse` одинаково проверяет текст и разрешённые tool calls. Запрос инструмента — данные для подтверждения оператором, а не выполнение команды. Без `allowSiemTools` tool calls отбрасываются. AI-вложения сохраняют длинные текстовые поля в пределах собственного бюджета 2 MiB и не наследуют обрезку текста карточки расследования до 20 тысяч символов. Поля секретов удаляются при нормализации вложения; политика выбора остальных полей применяется перед предпросмотром.

`createGraphSnapshots({storage,prefix,maxSnapshots,maxBytes,idPattern})` принимает интерфейс `get/set/remove`. По умолчанию сохраняет десять снимков, каждый до 64 MiB и 10 тысяч узлов. При восстановлении проверяет schemaVersion, ID, время создания, origin и размер графа. `context` — непрозрачные данные адаптера для последующего обращения к SIEM. Исходное событие и evidence сохраняются без изменения; обновление оставляет исходные ID и createdAt. Автоматической миграции посторонних схем нет.

## `filters/platform` (1.3)

`detectEventPlatform({ os, source, paths })` accepts arrays of evidence selected by the SIEM adapter and returns `windows`, `unix`, or `unknown`. Explicit OS evidence takes precedence over source-product names, which take precedence over absolute path syntax. Conflicting evidence at the same priority is unknown. Hostnames, arbitrary event text, and event IDs are not OS evidence.

`normalizeFilterPlatforms(platforms)` normalizes optional `windows`/`unix` restrictions. An empty array means a universal filter. `filterSupportsPlatform(filter, platform)` permits universal filters and matching restricted filters; unknown systems do not enable restricted filters. Adapters preserve this metadata when saving custom filters and supply their own field aliases. Existing query rendering remains unchanged.

