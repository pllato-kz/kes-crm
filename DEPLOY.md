# DEPLOY.md — развёртывание KES CRM с нуля

Runbook для разворачивания проекта на **новом Cloudflare-аккаунте** (передача клиенту).
Тот же код работает у любого клиента — под клиента меняется только `wrangler.toml`
(его ресурсы) и данные в БД. Никаких клиентских строк в коде.

## Стек

- **Frontend:** vanilla HTML/CSS/JS, без сборки — `index.html`, `styles.css`, `api.js`,
  `data.js` (только справочные константы-фолбэк), `app.js`.
- **Backend:** Cloudflare **Pages Functions** — `functions/api/[[path]].js` (единый REST
  над D1/R2). Тот же домен, что и фронт → без CORS.
- **Данные:** Cloudflare **D1** (база). **R2** — файлы/вложения.
- **Авторизация:** JWT (HS256), пароли — PBKDF2; секрет подписи — в секрете Pages.

```
schema.sql   — структура БД (CREATE TABLE + индексы)
seed.sql     — справочники (нужны всегда) + демо-данные (опционально)
wrangler.toml — биндинги ресурсов (единственный файл под клиента)
```

## 0. Предварительно

- Аккаунт Cloudflare.
- Node 18+ и `wrangler` (`npx wrangler ...` или `npm i -g wrangler`).
- Авторизация одним из способов:
  - `wrangler login` (интерактивно), **или**
  - `export CLOUDFLARE_API_TOKEN=...` и `export CLOUDFLARE_ACCOUNT_ID=...`
    Токен с правами: **D1 Edit**, **Cloudflare Pages Edit**, **R2 (Workers R2 Storage) Edit**.

## 1. Создать ресурсы Cloudflare

```bash
wrangler d1 create kes-crm-db          # запомнить database_id из вывода
wrangler r2 bucket create kes-crm-files
```

Pages-проект создастся при первом `pages deploy` (или создайте заранее в дашборде;
имя проекта = поддомен `<имя>.pages.dev`).

## 2. Прописать ресурсы в `wrangler.toml`

Единственный файл, который меняется под клиента:

```toml
name = "<имя-pages-проекта>"
compatibility_date = "2024-11-01"
pages_build_output_dir = "."

[[d1_databases]]
binding = "DB"
database_name = "kes-crm-db"
database_id = "<database_id из шага 1>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "kes-crm-files"
```

Имена биндингов (`DB`, `BUCKET`) в коде универсальны — их менять не нужно.

## 3. Накатить схему и данные на D1

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
  `notifications`. Для своего клиента эти секции можно удалить и завести данные через UI.

> `seed.sql` сгенерирован из `data.js` (объект `SEED`). Пользователи засеяны **без паролей**
> (`password_hash = NULL`) — пароль задаётся после деплоя (шаг 6).

## 4. Задать секрет подписи JWT

```bash
wrangler pages secret put JWT_SECRET --project-name=<имя-проекта>
# значение: например  openssl rand -base64 48
```

Без `JWT_SECRET` эндпоинт `/api/login` вернёт 500.

## 5. Деплой

**Важно:** деплоить только из чистого `dist/`, не из корня репозитория — иначе в публичную
статику попадут `schema.sql`, `seed.sql`, `wrangler.toml` и прочее (для Pages файл
`.assetsignore` ненадёжен).

```bash
rm -rf dist && mkdir dist
cp index.html styles.css data.js app.js api.js dist/
cp -r functions dist/functions
wrangler pages deploy dist --project-name=<имя-проекта>
```

После деплоя сайт доступен на `https://<имя-проекта>.pages.dev`.

## 6. Первый вход (bootstrap пароля)

Пользователи засеяны без паролей. Задать пароль директору — это работает **один раз**,
пока пароль не задан, без токена (см. `setPasswordRoute`):

```bash
curl -X POST https://<домен>/api/users/u5/password \
  -H 'content-type: application/json' \
  -d '{"password":"ВАШ_ПАРОЛЬ"}'
```

(`u5` — id директора из сида. Если демо-пользователи удалены — сначала создайте
директора прямым `INSERT` в `users` или восстановите соответствующую секцию сида.)

Дальше войдите на сайте под email директора + заданный пароль. Пароли остальным
пользователям директор задаёт в разделе **Настройки**.

## 7. Проверка

1. Открыть сайт → войти под директором.
2. Создать клиента → перезагрузить страницу → клиент на месте.
3. Открыть с другого устройства/браузера — данные те же (общая база, не localStorage).

## Сводка биндингов и секретов

| Имя | Где задаётся | Назначение |
|-----|--------------|------------|
| `DB` | `wrangler.toml` | D1 база (`kes-crm-db`) |
| `BUCKET` | `wrangler.toml` | R2 бакет (`kes-crm-files`) |
| `JWT_SECRET` | `wrangler pages secret put` | подпись JWT |
| `PBKDF2_ITERATIONS` | (опц.) переменная окружения | стойкость хэша паролей (по умолч. 100000) |

## Роли (из сида, таблица `roles`)

`director` (видит всё), `manager` (только свои сделки/клиенты), `warehouse`
(склад/отгрузки/каталог), `accountant` (документы/счета/контрагенты). Набор разделов и
права — данные в БД (`modules`, `can_edit`), не в коде.

## Автодеплой (опционально)

- Подключить Pages-проект к GitHub-репо (push в `main` → автодеплой), **или**
- GitHub Actions с секретами `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`.

При любом автодеплое публиковать **только** статику + `functions/` (как в шаге 5),
не весь репозиторий.

## Локальный запуск фронта (без бэкенда)

```bash
python3 -m http.server 8805   # http://127.0.0.1:8805
```

Покажет экран входа; для работы нужен задеплоенный `/api/*` (Functions + D1).

## Управление базой

```bash
# выполнить SQL на боевой базе
wrangler d1 execute kes-crm-db --remote --command="SELECT COUNT(*) FROM clients"
# консоль
wrangler d1 execute kes-crm-db --remote --command="..."
```
