# CLAUDE.md

Гайд для работы с этим репозиторием. Проект на русском — комментарии, UI и данные на русском, держим этот стиль.

## Что это

Интерактивный фронт-прототип (мокап) CRM для **ТОО KazEnergoSnab** — карагандинского дистрибьютора электротехники EKF. Демо **без бэкенда**: всё состояние живёт в `localStorage`, демо-данные засеиваются один раз и редактируются прямо в UI.

Демо: https://kes-crm.pages.dev

## Стек и архитектура

- **Vanilla HTML / CSS / JS** — без сборки, без npm, без фреймворков, **без ES-модулей**. Всё подключается через `<script src>` в `index.html`.
- **Chart.js 4.4.1** (CDN) — графики в отчётах.
- Шрифт **Inter** (Google Fonts). Брендинг: голубой `#00A6E2` + чёрный.
- **Деплой:** Cloudflare Pages — push в `main` авто-деплоит на `kes-crm.pages.dev`. Ручной: `wrangler pages deploy . --project-name=kes-crm`.
- Состояние/сессия в `localStorage`: ключи `kes_crm_state_v3` (данные) и `kes_session_v1` (сессия).

## Структура файлов

```
index.html   — оболочка: сайдбар, хедер, main, модалка, тосты; подключение скриптов; глобальный отлов ошибок
styles.css   — дизайн-система и вся вёрстка
data.js      — демо-данные (SEED), справочники (STAGES, ROLES, CLIENT_TYPES), helpers стора и сессии
app.js       — вся логика: роутер, рендер 12 модулей, формы, права, печать счёта-фактуры
.wrangler/   — кэш Cloudflare wrangler (служебное, не трогаем)
```

### `data.js`

Всё обёрнуто в IIFE, наружу торчит только `window.__KES__`.

- **`SEED`** — демо-наполнение: `users` (5), `categories` (21), `products` (~25 SKU EKF), `clients` (15), `deals` (12), `leads` (5), `suppliers` (5), `tasks` (8), `invoices` (6), `shipments` (4), `receipts` (3), `notifications` (4). Реалистичные данные: настоящие SKU EKF, казахстанские БИНы (12 цифр), цены в тенге.
- **`STAGES`** — 8 этапов сделки: `new → kp → agreed → invoice → paid → shipped → closed` / `lost`, каждый с цветом.
- **`ROLES`** — 4 роли (`director`, `manager`, `warehouse`, `accountant`). У каждой: `modules` (видимые разделы), `canEdit` (матрица прав), `seeAllData` (менеджер — только своё).
- **`CLIENT_TYPES`** — `opt` / `rozn` / `dilr`.
- **Helpers:** `loadState/saveState/resetState`, `getSession/setSession/clearSession`.

### `app.js`

Тоже одна IIFE. Логические блоки:

- **Helpers:** `$`, `$$`, `el(tag, attrs, children)` (создание DOM), форматтеры `fmtMoney/fmtMoneyK/fmtDate`, `byId`, `userById`, `clientById`, `categoryById`, `stageById`.
- **Роутер:** `VIEWS{}`, массив `ROUTES`, `navigate(view, params)` — гейт прав (🔒 «Нет доступа»), подсветка кнопки, рендер в `#main`. Навигация — делегированные клики по `#nav button[data-view]` и `[data-nav]`.
- **UI-примитивы:** `toast()`, `stub()` (заглушка «появится после подключения бэка»), `openModal/closeModal`.
- **Формы:** хелперы `fInput/fSelect/fTextarea` + конструкторы создания (клиент, заявка, задача, товар, поставщик, отгрузка, счёт) и `convertLead()`.
- **Детальные карточки:** продукт, отгрузка, счёт, поставщик, клиент, сделка; уведомления, «О программе».
- **Печать счёта-фактуры:** `printInvoice(deal)` + `numberToRussianWords()` / `plural()` (сумма прописью, реквизиты KES).
- **Поиск:** `runSearch(q)` — по клиентам, сделкам, SKU.
- **VIEWS (12 экранов):** `dashboard`, `leads`, `deals` (Kanban + drag-drop, line items, авторасчёт суммы), `clients`, `catalog`, `warehouse`, `shipments`, `invoices`, `suppliers`, `tasks`, `reports` (Chart.js), `settings` (+ админка пользователей и матрица прав).
- **Логин / права / boot:** `renderLogin()` (4 демо-роли плитками), `doLogin/logout`, `role()`, `can(action, target)`, фильтры `visibleDeals/visibleClients/visibleTasks`, `bootApp()` → `renderShell()` (строит сайдбар только из разрешённых ролью модулей) → `navigate()`. Точка входа — вызов `bootApp()` в самом конце файла.

## Ключевые механики

- **Роль-based доступ.** Сайдбар, гейт в роутере и матрица `canEdit` строятся из `ROLES`. Менеджер видит только свои сделки/клиентов (`seeAllData: false`).
- **Сделки** — самый «живой» модуль: Kanban с drag-drop по этапам, реальные позиции из каталога (`lineItems`) с авторасчётом суммы.
- **Печать СФ** — генерация счёта-фактуры с реквизитами KES и суммой прописью.
- **Заглушки (`stub`)** — действия, требующие бэкенда, честно помечены «появится после Cloudflare Worker + D1».

## Локальный запуск

```bash
python3 -m http.server 8805
# открыть http://127.0.0.1:8805
```

## Конвенции

- Язык интерфейса, данных и комментариев — **русский**. Сохраняем.
- Никакого билд-шага: правим файлы напрямую, новые скрипты подключаем через `<script src>` в `index.html`.
- Новые данные — в `SEED` (`data.js`); при изменении формата стора поднимаем версию ключа `STORE_KEY` (сейчас `kes_crm_state_v3`) и чистим старые в `data.js`.
- DOM собираем через хелпер `el()`, а не innerHTML-конкатенацией (кроме крупных статичных шаблонов вроде `renderShell`).
- Права проверяем через `can(action, target)`, видимость данных — через `visible*()`.
```
