# MIGRATION.md — перенос KES CRM на новый сервер и передача клиенту

Полная инструкция: развернуть систему **с нуля** на новом Cloudflare-аккаунте,
**перенести данные** со старого, настроить интеграции (1С, WhatsApp, телефония) и
**передать проект клиенту**. Рассчитано на разработчика без предыдущего контекста.

> Код **не зависит от клиента**: под нового клиента меняются только `wrangler.toml`
> (его ресурсы), секреты и данные в БД. Никаких клиентских строк в исходниках нет.

---

## 1. Архитектура (что переносим)

| Слой | Технология | Где живёт |
|------|-----------|-----------|
| Frontend | vanilla HTML/CSS/JS, без сборки | `index.html`, `styles.css`, `app.js`, `api.js`, `data.js`, `sip-client.js` |
| Backend (REST API) | Cloudflare **Pages Functions** | `functions/api/[[path]].js` — единый роутер `/api/*` |
| База данных | Cloudflare **D1** (SQLite) | биндинг `DB` |
| Файлы/вложения | Cloudflare **R2** | биндинг `BUCKET` |
| Авторизация | JWT (HS256) + PBKDF2 (пароли) | секрет `JWT_SECRET` |
| Фоновый синк 1С | GitHub Actions → `POST /api/sync/run` | секрет `CRON_SECRET` |

Фронт и API на одном домене (`<проект>.pages.dev`) → **CORS не нужен**.

Внешние зависимости фронта подключаются с CDN (интернет на клиенте обязателен):
Chart.js, SheetJS (xlsx), jsPDF, html2canvas, шрифт Inter (Google Fonts).

```
schema.sql    — структура БД (CREATE TABLE + индексы)
seed.sql      — справочники (нужны всегда) + демо-данные (опционально)
wrangler.toml — биндинги ресурсов (единственный файл под клиента)
.github/workflows/sync-1c.yml — расписание фонового синка 1С
sip-connector/                — отдельный модуль телефонии (Asterisk + Binotel)
```

---

## 2. Чек-лист переноса (TL;DR)

1. [ ] Создать ресурсы Cloudflare: D1 + R2 (раздел 4).
2. [ ] Прописать их в `wrangler.toml` (раздел 5).
3. [ ] Накатить `schema.sql` (+ `seed.sql` для чистого старта) **или** мигрировать данные со старого (раздел 6 / 7).
4. [ ] Задать секреты: минимум `JWT_SECRET`; для интеграций — остальные (раздел 8).
5. [ ] Задеплоить статику + functions (раздел 9).
6. [ ] Bootstrap пароля директора (раздел 10).
7. [ ] Настроить фоновый синк 1С — GitHub Actions (раздел 11).
8. [ ] Smoke-тест (раздел 12).
9. [ ] Передать клиенту: владение аккаунтом, доступы, секреты (раздел 13).

---

## 3. Предварительные требования

- Аккаунт **Cloudflare** (новый — на клиента).
- **Node.js 18+** и **wrangler** (`npx wrangler ...` без установки, либо `npm i -g wrangler`).
- Авторизация wrangler одним из способов:
  - `wrangler login` (интерактивно), **или**
  - переменные окружения:
    ```bash
    export CLOUDFLARE_API_TOKEN=...
    export CLOUDFLARE_ACCOUNT_ID=...
    ```
    Права токена: **D1 Edit**, **Cloudflare Pages Edit**, **Workers R2 Storage Edit**.
- Доступ к Git-репозиторию проекта.

---

## 4. Создать ресурсы Cloudflare

```bash
wrangler d1 create kes-crm-db            # ЗАПОМНИТЬ database_id из вывода
wrangler r2 bucket create kes-crm-files
```

Pages-проект создаётся при первом `pages deploy` (или заранее в дашборде; имя
проекта = поддомен `<имя>.pages.dev`).

---

## 5. Настроить `wrangler.toml`

Единственный файл, который меняется под клиента:

```toml
name = "<имя-pages-проекта>"
compatibility_date = "2024-11-01"
pages_build_output_dir = "."

[[d1_databases]]
binding = "DB"
database_name = "kes-crm-db"
database_id = "<database_id из шага 4>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "kes-crm-files"
```

Имена биндингов (`DB`, `BUCKET`) в коде универсальны — менять их не нужно.

---

## 6. Вариант А — чистая установка (новый клиент без данных)

```bash
wrangler d1 execute kes-crm-db --remote --file=schema.sql
wrangler d1 execute kes-crm-db --remote --file=seed.sql
```

`seed.sql` состоит из двух частей (см. комментарии-секции внутри файла):

- **Справочники (нужны всегда):** `company`, `roles`, `deal_stages`, `client_types`,
  `product_categories`, `warehouses`, `lead_sources`, `lead_statuses`,
  `shipment_statuses`, `invoice_statuses`, `task_priorities`.
- **Демо-данные (опционально):** `users`, `products`/`product_stock`, `clients`/`tags`,
  `deals`/`deal_items`, `leads`, `tasks`, `invoices`, `shipments`, `receipts`,
  `notifications`. Для боевого клиента эти секции можно удалить — данные подтянутся
  из 1С (контрагенты/номенклатура/остатки) и заведутся через UI.

> Пользователи в сиде — **без паролей** (`password_hash = NULL`); пароль задаётся
> после деплоя (раздел 10).

Затем переходите к разделу 8 (секреты).

---

## 7. Вариант Б — перенос данных со старого сервера

Когда нужно перенести **существующую** базу и файлы.

### 7.1 База данных (D1)

**Экспорт со старого аккаунта** (выполнять с доступом к старому Cloudflare):

```bash
wrangler d1 export kes-crm-db --remote --output=backup.sql
# только данные, без схемы (если схему накатываете отдельно):
#   wrangler d1 export kes-crm-db --remote --no-schema --output=data-only.sql
```

**Импорт в новый D1:**

```bash
# 1) структура (если дамп без схемы) — иначе пропустить
wrangler d1 execute kes-crm-db --remote --file=schema.sql
# 2) данные
wrangler d1 execute kes-crm-db --remote --file=backup.sql
```

Проверка количества строк после импорта:

```bash
wrangler d1 execute kes-crm-db --remote \
  --command="SELECT 'clients' t, COUNT(*) n FROM clients
             UNION ALL SELECT 'products', COUNT(*) FROM products
             UNION ALL SELECT 'deals', COUNT(*) FROM deals"
```

> Лимиты D1 на импорт большие, но если дамп очень крупный — бейте на части или
> используйте `--file` несколько раз. `schema.sql` идемпотентен в части `ALTER`,
> которые код докатывает на лету (`ensure*Columns`), так что версия схемы значения не имеет.

### 7.2 Файлы (R2)

Вложения (фото доставки, загруженные документы) лежат в R2-бакете. Перенос бакета
целиком — через **rclone** (S3-совместимый API R2):

1. В дашборде Cloudflare → R2 → **Manage R2 API Tokens** создать токен (на обоих аккаунтах).
2. Настроить два remote в `~/.config/rclone/rclone.conf`:

   ```ini
   [r2old]
   type = s3
   provider = Cloudflare
   access_key_id = <OLD_ACCESS_KEY>
   secret_access_key = <OLD_SECRET>
   endpoint = https://<OLD_ACCOUNT_ID>.r2.cloudflarestorage.com

   [r2new]
   type = s3
   provider = Cloudflare
   access_key_id = <NEW_ACCESS_KEY>
   secret_access_key = <NEW_SECRET>
   endpoint = https://<NEW_ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

3. Скопировать всё:

   ```bash
   rclone copy r2old:kes-crm-files r2new:kes-crm-files --progress
   ```

> Ключи к файлам в БД хранятся как относительные пути, поэтому при сохранении имени
> бакета и структуры ничего в данных править не нужно — ссылки останутся валидными.

Дальше — раздел 8 (секреты).

---

## 8. Секреты и переменные окружения

Задаются командой:

```bash
wrangler pages secret put <ИМЯ> --project-name=<имя-проекта>
```

(или в дашборде: **Pages → проект → Settings → Environment variables / Secrets**;
секреты задавать для окружения **Production**, а при использовании preview — и для Preview).

### Обязательные

| Секрет | Назначение | Пример значения |
|--------|-----------|-----------------|
| `JWT_SECRET` | подпись JWT. Без него `/api/login` → 500 | `openssl rand -base64 48` |

### Фоновый синк (нужен, если используете 1С/расписание)

| Секрет | Назначение |
|--------|-----------|
| `CRON_SECRET` | токен для `POST /api/sync/run?token=...`. Тот же, что в GitHub Actions |

### Интеграция с 1С (OData)

| Секрет | Назначение |
|--------|-----------|
| `ODATA_URL` | базовый URL публикации 1С OData, напр. `https://1c.example.kz/base/odata/standard.odata` |
| `ODATA_USER` | пользователь 1С (только чтение/нужные права) |
| `ODATA_PASSWORD` | пароль пользователя 1С |
| `ONEC_SHIPMENTS` | `1` — разрешить отправку черновиков «Реализация» в 1С (по умолчанию выкл.) |

Без `ODATA_*` синк просто не выполняется (CRM работает на ручных данных).

### WhatsApp (Green API)

| Секрет | Назначение |
|--------|-----------|
| `GREENAPI_INSTANCE` | id инстанса Green API |
| `GREENAPI_TOKEN` | токен инстанса |
| `GREENAPI_URL` | (опц.) базовый URL, по умолч. `https://api.green-api.com` |

Webhook в Green API настроить на `https://<домен>/api/greenapi/webhook` (входящие сообщения → клиент + сделка).

> Точный URL вебхука **с токеном** (`?token=...`) CRM показывает в **Настройках →
> WhatsApp** — скопируйте его оттуда в кабинет Green API.

### Телефония (SIP / Binotel через Asterisk) — опционально

| Секрет | Назначение |
|--------|-----------|
| `SIP_DOMAIN` | домен/адрес SIP-сервера (Asterisk) |
| `SIP_USER` | SIP-логин webrtc-эндпоинта |
| `SIP_ENDPOINT_PASSWORD` | пароль SIP-эндпоинта |
| `SIP_TURN_URL` | TURN-сервер для WebRTC |
| `SIP_TURN_USERNAME` | логин TURN |
| `SIP_TURN_PASSWORD` | пароль TURN |

Пока секреты не заданы — `/api/sip/token` отдаёт 503, и звонок в браузере мягко
деградирует на `tel:`. Подъём Asterisk/Binotel — см. `sip-connector/` (раздел 8.1).

### Прочее

| Переменная | Назначение |
|-----------|-----------|
| `PBKDF2_ITERATIONS` | (опц.) стойкость хэша паролей, по умолч. `100000` |

### 8.1 Телефония — инфраструктура

Код softphone готов, но требует **вашей инфраструктуры**:
- VM с Asterisk 22 — скрипт развёртывания `sip-connector/setup-asterisk.sh`;
- SIP-транк Binotel + whitelist IP сервера в кабинете Binotel;
- TURN/STUN для WebRTC;
- секреты `SIP_*` в Cloudflare (выше).

Подробности и схема — `sip-connector/INTEGRATION-NOTES.md`.

---

## 9. Деплой

**Важно:** деплоить из чистого `dist/`, не из корня репозитория — иначе в публичную
статику попадут `schema.sql`, `seed.sql`, `wrangler.toml`, доки и т.п.

```bash
rm -rf dist && mkdir dist
cp index.html styles.css data.js app.js api.js sip-client.js dist/
cp -r functions dist/functions
wrangler pages deploy dist --project-name=<имя-проекта>
```

> Список статики: `index.html`, `styles.css`, `api.js`, `data.js`, `app.js`,
> **`sip-client.js`** (он подключён в `index.html` — не забыть). Остальные ресурсы
> (Chart.js, xlsx, jsPDF, html2canvas, шрифт) грузятся с CDN.

После деплоя сайт доступен на `https://<имя-проекта>.pages.dev`.

### 9.1 Автодеплой (рекомендуется для клиента)

- **Вариант 1:** в дашборде подключить Pages-проект к GitHub-репо → push в `main`
  запускает сборку. В настройках сборки указать выпуск только статики + `functions/`.
- **Вариант 2:** GitHub Actions с секретами репозитория `CLOUDFLARE_API_TOKEN` и
  `CLOUDFLARE_ACCOUNT_ID`, шаг `wrangler pages deploy dist`.

В любом случае публиковать **только** `dist/` (статика + `functions/`), не весь репозиторий.

---

## 10. Первый вход (bootstrap пароля)

Пользователи засеяны без паролей. Задать пароль директору можно **один раз**, пока
пароль не задан, без токена (см. `setPasswordRoute`):

```bash
curl -X POST https://<домен>/api/users/<id_директора>/password \
  -H 'content-type: application/json' \
  -d '{"password":"СИЛЬНЫЙ_ПАРОЛЬ"}'
```

- `<id_директора>` — id из сида (в демо это `u5`). Узнать:
  ```bash
  wrangler d1 execute kes-crm-db --remote \
    --command="SELECT id,email,role_key FROM users WHERE role_key='director'"
  ```
- Если демо-пользователи удалены — сначала создайте директора `INSERT` в `users`.

Затем войдите на сайте под email директора и заданным паролем. Пароли остальным
сотрудникам директор задаёт в разделе **Настройки**.

---

## 11. Фоновая синхронизация с 1С (cron)

Синк работает 24/7 независимо от того, открыта ли CRM. Триггерит GitHub Actions
(`.github/workflows/sync-1c.yml`) — каждые 5 минут дёргает `POST /api/sync/run`,
который сам запускает только «просроченные» по интервалам синки.

В GitHub-репозитории → **Settings → Secrets and variables → Actions** задать:

| Секрет репозитория | Значение |
|--------------------|----------|
| `CRM_URL` | `https://<имя-проекта>.pages.dev` |
| `CRON_SECRET` | то же значение, что секрет `CRON_SECRET` в Cloudflare |

Интервалы синка заданы в коде (`SYNC_INTERVALS`): остатки/клиенты/приходы ~5 мин,
номенклатура ~30 мин, цены ~10 мин, оплаты счетов ~15 мин, резервы ~60 мин.

> Альтернатива GitHub Actions — любой внешний планировщик (cron-job.org, серверный
> crontab), бьющий тот же URL с тем же токеном.

---

## 12. Smoke-тест после переноса

1. Открыть сайт → войти под директором.
2. Создать клиента → перезагрузить страницу → клиент на месте (данные в D1, не в браузере).
3. Открыть с другого устройства — данные те же.
4. Каталог: поиск товара работает, цены отображаются.
5. Если подключён 1С: подождать ~5–10 мин → в Складе появляются остатки; в `sync_state`
   свежие отметки:
   ```bash
   wrangler d1 execute kes-crm-db --remote --command="SELECT entity,last_at,info FROM sync_state"
   ```
6. Если подключён WhatsApp: тестовое входящее сообщение создаёт сделку/лог.
7. Загрузка файла (фото в отгрузке) → файл открывается (проверка R2).

---

## 13. Передача проекта клиенту

1. **Владение аккаунтом Cloudflare.** Разворачивать сразу на аккаунте клиента —
   тогда передавать нечего, только доступы. Если разворачивали на своём — перенести
   проект на аккаунт клиента (раздел 6/7 на их аккаунте) либо добавить клиента как
   администратора (Cloudflare → Members).
2. **Передать клиенту (в защищённом виде):**
   - доступ к аккаунту Cloudflare (D1, R2, Pages, секреты);
   - доступ к Git-репозиторию;
   - значения всех секретов из раздела 8 (1С, Green API, SIP);
   - учётку директора в CRM (email + первый пароль).
3. **Сменить все секреты** после передачи: `JWT_SECRET` (разлогинит всех — это нормально),
   `CRON_SECRET`, пароли 1С/Green API при необходимости.
4. **Передать документацию:** этот файл, `DEPLOY.md`, `README.md`,
   `sip-connector/INTEGRATION-NOTES.md`.
5. **Бэкап перед стартом** (раздел 14).

---

## 14. Обслуживание

### Бэкап БД (регулярно/перед изменениями)

```bash
wrangler d1 export kes-crm-db --remote --output=backup-$(date +%F).sql
```

### Бэкап файлов

```bash
rclone copy r2new:kes-crm-files ./r2-backup-$(date +%F) --progress
```

### Произвольный SQL на боевой базе

```bash
wrangler d1 execute kes-crm-db --remote --command="SELECT COUNT(*) FROM clients"
```

### Роли (таблица `roles`)

`director` (видит всё), `manager` (только свои сделки/клиенты, без закупочных цен),
`warehouse` (склад/отгрузки/каталог), `accountant` (документы/счета/контрагенты).
Набор разделов и права — данные в БД (`modules`, `can_edit`), не в коде.

---

## 15. Траблшутинг

| Симптом | Причина / решение |
|---------|-------------------|
| `/api/login` → 500 | не задан `JWT_SECRET` |
| Логин «неверный пароль» у всех | у пользователей `password_hash = NULL` — выполните bootstrap (раздел 10) |
| В статике видны `schema.sql`/`wrangler.toml` | деплой шёл из корня — деплойте из `dist/` (раздел 9) |
| Не грузится интерфейс, белый экран | не скопирован один из JS (`sip-client.js` и др.) в `dist/` |
| Остатки/клиенты из 1С не появляются | не заданы `ODATA_*`, либо не настроен cron (`CRM_URL`/`CRON_SECRET`), либо нет сетевого доступа к 1С |
| `sync_state` пустой / старый | GitHub Actions не запускается или `CRON_SECRET` не совпадает |
| Звонок в браузере не идёт | `SIP_*` не заданы / Asterisk не поднят — это ожидаемо, идёт fallback на `tel:` |
| Файлы не открываются | R2-бакет не привязан (`BUCKET`) или объекты не перенесены (раздел 7.2) |
| Поиск товара: `LIKE ... too complex` | устаревшая версия кода; обновите деплой (поиск разбит на слова) |

---

## 16. Карта файлов проекта

```
index.html        — точка входа; подключает api.js, data.js, app.js, sip-client.js + CDN
styles.css        — все стили
app.js            — весь фронтенд (вью, карточки, модалки)
api.js            — слой API (map/toApi, apiFetch, загрузка справочников)
data.js           — справочные константы-фолбэк (SEED для генерации seed.sql)
sip-client.js     — браузерный softphone (SIP.js)
functions/
  api/[[path]].js — весь backend: REST /api/*, синки 1С, вебхуки, авторизация, cron
schema.sql        — структура БД
seed.sql          — справочники (+ демо-данные)
wrangler.toml     — биндинги ресурсов (единственный файл под клиента)
.github/workflows/sync-1c.yml — расписание фонового синка 1С
sip-connector/    — телефония: setup-asterisk.sh + INTEGRATION-NOTES.md
DEPLOY.md         — краткий runbook деплоя
MIGRATION.md      — этот файл (перенос + передача)
README.md         — обзор проекта
```

---

**Минимальный путь «с нуля»:** разделы 4 → 5 → 6 → 8 (только `JWT_SECRET`) → 9 → 10 → 12.
**Перенос существующего:** разделы 4 → 5 → 7 → 8 → 9 → 11 → 12 → 13.
