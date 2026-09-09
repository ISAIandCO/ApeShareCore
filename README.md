# ApeShareCore

Автономные JavaScript-модули для [ApePatrol](https://github.com/ISAIandCO/ApePatrol), [KumApe](https://github.com/ISAIandCO/KumApe) и других приложений семейства Ape. Это библиотека времени сборки: установленное расширение уже содержит нужный код и не загружает его с GitHub.

## Модули

| Импорт после `@isaiandco/ape-share-core/` | Что делает |
|---|---|
| `ioc/client`, `ioc/providers`, `ioc/normalize` | API VirusTotal, AbuseIPDB, OpenTIP, ThreatFox; каталог и нормализация IOC |
| `ioc/ui` | Переиспользуемые кнопки проверки IOC; принимает функции запроса и вывода результата |
| `ioc/batch` | Формирование заданий, нормализация результатов, ключи и срок жизни кеша; без хранилища |
| `ai/transport` | OpenAI-совместимый запрос: endpoint, payload, необязательный ключ, timeout и AbortSignal |
| `ai/chat` | Модель диалога, вложений и запросов инструментов; без доступа к AI и без persistence |
| `investigation/model` | Модель расследования, прикреплённые объекты, JSON/Markdown экспорт; без IndexedDB |
| `events/compare` | Сравнение 2–3 событий с переданной функцией группировки полей |
| `graph/force-layout`, `graph/spatial-index` | Физика графа и поиск узлов в пространстве |
| `ui/markdown` | Безопасный Markdown renderer для переданного DOM-контейнера |
| `values/ip`, `values/hash`, `values/url` | Разбор и нормализация значений |

Модули подключаются независимо через `exports` пакета. Нет runtime-зависимостей. `ioc/batch`, `ai/chat` и `investigation/model` уже используются ApePatrol и доступны другим приложениям без подключения его SIEM-кода.

## Подключение

Установите пакет из Git с полным SHA выбранного проверенного коммита:

```sh
npm install --save-exact '@isaiandco/ape-share-core@https://codeload.github.com/ISAIandCO/ApeShareCore/tar.gz/<40-character-commit-sha>'
```

```js
import { lookupIoc } from '@isaiandco/ape-share-core/ioc/client';
import { mountIocActions } from '@isaiandco/ape-share-core/ioc/ui';

const result = await lookupIoc('virustotal', { type: 'ip', value: '8.8.8.8' },
  { virusTotalApiKey: apiKey }, { fetchImpl, signal });

const controls = mountIocActions(container, {
  ioc: { type: 'ip', value: '8.8.8.8' },
  lookup: (provider, ioc) => application.lookupWithPermission(provider, ioc),
  onResult: result => application.showResult(result),
  onError: error => application.showError(error.message),
});
// При уничтожении контейнера:
controls.destroy();
```

Ключи, разрешения браузера, SQL/PDQL, извлечение полей SIEM, вкладки, маршруты, хранилища и настройки передаются или обрабатываются приложением. В UI можно передать `addButton(label, handler)`, чтобы сохранить существующее оформление и поведение меню. Монтирование кнопок само по себе не выполняет запросов.

## Совместимость

[CONTRACTS.md](CONTRACTS.md) фиксирует входы, выходы, побочные эффекты и правила версионирования. Изменение внутренних алгоритмов допускается при сохранении контракта. Несовместимый API или формат данных требует новой major-версии и миграции в приложении. Автоматические обновления расширений принимают только более новую совместимую версию 1.x, закрепляют её SHA и создают PR после проверок; автомержа нет.

Это контролируемая совместимость, а не обещание отсутствия любых ошибок. Проверки включают контрактные тесты библиотеки и тесты потребителей. Импорт библиотеки не требует `browser`, `window` или `document`; DOM нужен только при явном вызове UI renderer.

## Разработка

```sh
npm ci
npm run check
npm test
npm pack
```

`check` проверяет публичные entry point и отсутствие зависимостей от браузерного хранилища и продуктовой SIEM-логики. CI также собирает пакет. Workflow `Consumer compatibility` подставляет кандидата библиотеки в подключённые версии расширений из `main`, выполняет их контрактные тесты, тесты и сборки. При первоначальном внедрении проверка конкретного потребителя начинается после слияния его PR подключения.

При изменении runtime-кода поднимайте версию пакета и добавляйте контрактный тест. Добавляйте новую возможность отдельным функциональным модулем; не импортируйте код из репозиториев расширений. Нельзя удалять старую возможность только потому, что её использует один потребитель.

Лицензия Apache-2.0. Начальные реализации перенесены из ApePatrol 3.4.15 и общего ядра 1.0.0 ApePatrol/KumApe.
