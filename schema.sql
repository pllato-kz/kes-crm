-- ============================================================================
-- KES CRM — схема базы данных (Cloudflare D1 / SQLite)
-- Слой 1 плана BACKEND_PLAN_KES.md. Только структура. Данные — в seed.sql (Слой 5).
--
-- Принципы (см. «Главное правило» в плане):
--   * Один деплой = один клиент = одна база. Мультитенантности в одной БД нет,
--     поэтому company_id по таблицам не тянем — настройки компании в одной строке
--     таблицы `company`.
--   * Никаких клиентских строк в коде: все справочники (роли, стадии, типы,
--     источники, склады, статусы) — таблицы, а не значения в JS. Клиент меняет
--     данные в БД, код остаётся прежним.
--   * ID сохраняем текстовыми, как в мокапе (u1, cl01, p001, d001…) — это упрощает
--     перенос SEED и стыковку с фронтом на Слое 4.
--   * Булевы значения — INTEGER 0/1 (в SQLite нет BOOLEAN). Даты — TEXT (ISO).
--     Деньги — INTEGER (тенге, без копеек).
--
-- Внешние ключи требуют `PRAGMA foreign_keys = ON;` на стороне подключения.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- СПРАВОЧНИКИ (выносим из кода в БД — требование клиент-независимости)
-- ----------------------------------------------------------------------------

-- Роли и права. modules/can_edit хранятся как JSON-текст, чтобы сохранить
-- ровно ту логику прав, что в мокапе (ROLES в data.js): can() и visible*().
-- 4 роли из мокапа: director, manager, warehouse, accountant — наполняются в seed.sql.
CREATE TABLE roles (
  key          TEXT PRIMARY KEY,            -- director | manager | warehouse | accountant
  label        TEXT NOT NULL,               -- «Директор», «Менеджер по продажам»…
  color        TEXT,
  modules      TEXT NOT NULL DEFAULT '[]',  -- JSON-массив видимых разделов
  can_edit     TEXT NOT NULL DEFAULT '{}',  -- JSON-объект матрицы прав
  see_all_data INTEGER NOT NULL DEFAULT 0   -- 1 = видит всё; 0 = только своё (менеджер)
);

-- Этапы воронки сделок (мокап STAGES): new→kp→agreed→invoice→paid→shipped→closed/lost
CREATE TABLE deal_stages (
  id    TEXT PRIMARY KEY,                    -- new | kp | agreed | invoice | paid | shipped | closed | lost
  label TEXT NOT NULL,
  color TEXT,
  sort  INTEGER NOT NULL DEFAULT 0           -- порядок колонок в Kanban
);

-- Типы клиентов (мокап CLIENT_TYPES): опт / розница / дилер
CREATE TABLE client_types (
  key   TEXT PRIMARY KEY,                    -- opt | rozn | dilr
  label TEXT NOT NULL,
  color TEXT
);

-- Категории товаров (мокап SEED.categories, 21 шт.)
CREATE TABLE product_categories (
  id   TEXT PRIMARY KEY,                     -- c01..c21
  name TEXT NOT NULL,
  icon TEXT
);

-- Источники заявок (мокап leads.source): Сайт, Звонок, WhatsApp…
CREATE TABLE lead_sources (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Статусы заявок (мокап leads.status): new, in-work, converted
CREATE TABLE lead_statuses (
  id    TEXT PRIMARY KEY,                    -- new | in-work | converted
  label TEXT NOT NULL
);

-- Склады (мокап — один склад в Караганде; таблица на вырост под несколько складов)
CREATE TABLE warehouses (
  id      TEXT PRIMARY KEY,                  -- w1, w2…
  name    TEXT NOT NULL,
  city    TEXT,
  address TEXT
);

-- Статусы отгрузок (мокап shipments.status): planned, delivered…
CREATE TABLE shipment_statuses (
  id    TEXT PRIMARY KEY,                    -- planned | delivered | …
  label TEXT NOT NULL,
  color TEXT
);

-- Статусы счетов (мокап invoices.status): paid, pending, overdue
CREATE TABLE invoice_statuses (
  id    TEXT PRIMARY KEY,                    -- paid | pending | overdue
  label TEXT NOT NULL,
  color TEXT
);

-- Приоритеты задач (мокап tasks.priority): high, medium, low
CREATE TABLE task_priorities (
  id    TEXT PRIMARY KEY,                    -- high | medium | low
  label TEXT NOT NULL,
  color TEXT,
  sort  INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- КОМПАНИЯ (заменяет SEED.meta) — одна строка на деплой
-- ----------------------------------------------------------------------------
CREATE TABLE company (
  id       INTEGER PRIMARY KEY CHECK (id = 1), -- всегда одна строка
  tenant   TEXT NOT NULL,                       -- «KazEnergoSnab»
  city     TEXT,                                -- «Караганда»
  currency TEXT NOT NULL DEFAULT '₸'
);

-- ----------------------------------------------------------------------------
-- ПОЛЬЗОВАТЕЛИ (настоящая авторизация вместо пароля 'demo' в коде)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,            -- u1..u5
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,        -- логин
  password_hash TEXT,                        -- стойкий хэш (заполняется на Слое 3), НЕ открытый текст
  role_key      TEXT NOT NULL REFERENCES roles(key),
  phone         TEXT,
  avatar        TEXT,                        -- инициалы для аватарки
  color         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- КЛИЕНТЫ (B2B-контрагенты, дилеры)
-- ----------------------------------------------------------------------------
CREATE TABLE clients (
  id         TEXT PRIMARY KEY,               -- cl01..cl15
  name       TEXT NOT NULL,
  bin        TEXT,                           -- БИН/ИИН, 12 цифр
  type_key   TEXT REFERENCES client_types(key),
  contact    TEXT,                           -- контактное лицо
  phone      TEXT,
  email      TEXT,
  city       TEXT,
  address    TEXT,
  manager_id TEXT REFERENCES users(id),      -- закреплённый менеджер
  balance    INTEGER NOT NULL DEFAULT 0,     -- сальдо (минус = долг клиента)
  ltv        INTEGER NOT NULL DEFAULT 0,     -- сумма всех закупок
  last_deal  TEXT,                           -- дата последней сделки
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Теги клиентов (мокап clients.tags[]) — many-to-many
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE                  -- «постоянный», «ключевой», «дилер»…
);
CREATE TABLE client_tags (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- КАТАЛОГ ТОВАРОВ (1100+ SKU — нужны индексы под поиск)
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id              TEXT PRIMARY KEY,          -- p001…
  sku             TEXT NOT NULL UNIQUE,      -- артикул EKF
  name            TEXT NOT NULL,
  category_id     TEXT REFERENCES product_categories(id),
  brand           TEXT,
  unit            TEXT NOT NULL DEFAULT 'шт',-- шт, м…
  price_cost      INTEGER NOT NULL DEFAULT 0,-- закуп
  price_wholesale INTEGER NOT NULL DEFAULT 0,-- опт
  price_retail    INTEGER NOT NULL DEFAULT 0,-- розница
  image           TEXT,                      -- фото товара: путь /api/files/<key> в R2
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Остатки по складам (мокап хранит stock/reserved на товаре — кладём в один склад;
-- отдельная таблица позволяет несколько складов без правок кода)
CREATE TABLE product_stock (
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  stock        INTEGER NOT NULL DEFAULT 0,   -- физический остаток
  reserved     INTEGER NOT NULL DEFAULT 0,   -- зарезервировано под сделки
  PRIMARY KEY (product_id, warehouse_id)
);

-- ----------------------------------------------------------------------------
-- ПОСТАВЩИКИ
-- ----------------------------------------------------------------------------
CREATE TABLE suppliers (
  id            TEXT PRIMARY KEY,            -- sp1..sp5
  name          TEXT NOT NULL,
  contact       TEXT,
  phone         TEXT,
  email         TEXT,
  share         INTEGER NOT NULL DEFAULT 0,  -- доля в закупках, %
  last_delivery TEXT,
  note          TEXT
);

-- ----------------------------------------------------------------------------
-- СДЕЛКИ + позиции
-- ----------------------------------------------------------------------------
CREATE TABLE deals (
  id         TEXT PRIMARY KEY,               -- d001…
  no         TEXT UNIQUE,                    -- номер сделки «2026-0148»
  title      TEXT,
  client_id  TEXT REFERENCES clients(id),
  manager_id TEXT REFERENCES users(id),
  stage_id   TEXT NOT NULL REFERENCES deal_stages(id),
  amount     INTEGER NOT NULL DEFAULT 0,     -- сумма (пересчитывается по позициям)
  items      INTEGER NOT NULL DEFAULT 0,     -- кол-во позиций (денормализовано, как amount)
  created    TEXT,                           -- дата создания (из мокапа)
  target     TEXT,                           -- плановая дата закрытия
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Позиции сделки (мокап deals[].lineItems[])
CREATE TABLE deal_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id    TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL DEFAULT 1,
  price_used INTEGER NOT NULL DEFAULT 0      -- цена, по которой продали в этой сделке
);

-- История смены этапов сделки (кто и когда двигал)
CREATE TABLE deal_stage_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id    TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage TEXT,                            -- NULL при создании сделки
  to_stage   TEXT NOT NULL,
  user_id    TEXT,                            -- кто сменил (из JWT)
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- ЗАЯВКИ (lead) — ещё не сделки
-- ----------------------------------------------------------------------------
CREATE TABLE leads (
  id              TEXT PRIMARY KEY,          -- l01..l05
  source_id       INTEGER REFERENCES lead_sources(id),
  name            TEXT NOT NULL,
  phone           TEXT,
  subject         TEXT,
  status_id       TEXT NOT NULL REFERENCES lead_statuses(id),
  converted_deal  TEXT REFERENCES deals(id), -- если заявка превратилась в сделку
  created         TEXT,                      -- из мокапа («2026-05-27 09:14»)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- ЗАДАЧИ
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,              -- t01..t08
  title       TEXT NOT NULL,
  due         TEXT,                          -- срок
  owner_id    TEXT REFERENCES users(id),
  deal_id     TEXT REFERENCES deals(id),     -- может быть NULL
  priority_id TEXT REFERENCES task_priorities(id),
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- ДОКУМЕНТЫ: счета, отгрузки, приходы
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
  id         TEXT PRIMARY KEY,               -- iv01..iv06
  no         TEXT UNIQUE,                    -- «СФ-2026-0234»
  deal_id    TEXT REFERENCES deals(id),
  client_id  TEXT REFERENCES clients(id),
  date       TEXT,
  amount     INTEGER NOT NULL DEFAULT 0,
  status_id  TEXT REFERENCES invoice_statuses(id),
  due        TEXT,                           -- срок оплаты
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shipments (
  id          TEXT PRIMARY KEY,              -- sh01..sh04
  no          TEXT UNIQUE,                   -- «ТТН-0512»
  deal_id     TEXT REFERENCES deals(id),
  client_id   TEXT REFERENCES clients(id),
  date        TEXT,
  items       INTEGER NOT NULL DEFAULT 0,    -- кол-во позиций
  weight      INTEGER,                       -- кг
  transport   TEXT,
  driver      TEXT,
  status_id   TEXT REFERENCES shipment_statuses(id),
  destination TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Приходы на склад от поставщиков (мокап receipts — агрегированно, без позиций)
CREATE TABLE receipts (
  id          TEXT PRIMARY KEY,              -- rc01..rc03
  no          TEXT UNIQUE,                   -- «ПРХ-0089»
  supplier_id TEXT REFERENCES suppliers(id),
  date        TEXT,
  items       INTEGER NOT NULL DEFAULT 0,    -- кол-во позиций в приходе
  amount      INTEGER NOT NULL DEFAULT 0,
  status      TEXT,                          -- «оприходовано»
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- УВЕДОМЛЕНИЯ
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  type       TEXT,                           -- info | warn | error
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ИНДЕКСЫ — под поиск и внешние ключи
-- ============================================================================

-- Каталог (1100+ SKU): поиск по названию/артикулу, фильтр по категории/бренду
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand    ON products(brand);
CREATE INDEX idx_products_name     ON products(name);
-- sku уже UNIQUE → индекс есть автоматически

-- Клиенты
CREATE INDEX idx_clients_manager ON clients(manager_id);
CREATE INDEX idx_clients_type    ON clients(type_key);
CREATE INDEX idx_clients_bin     ON clients(bin);

-- Сделки и позиции
CREATE INDEX idx_deals_client     ON deals(client_id);
CREATE INDEX idx_deals_manager    ON deals(manager_id);
CREATE INDEX idx_deals_stage      ON deals(stage_id);
CREATE INDEX idx_deal_items_deal  ON deal_items(deal_id);
CREATE INDEX idx_deal_items_prod  ON deal_items(product_id);
CREATE INDEX idx_dsh_deal         ON deal_stage_history(deal_id);

-- Остатки
CREATE INDEX idx_stock_warehouse ON product_stock(warehouse_id);

-- Задачи
CREATE INDEX idx_tasks_owner ON tasks(owner_id);
CREATE INDEX idx_tasks_deal  ON tasks(deal_id);

-- Документы
CREATE INDEX idx_invoices_deal    ON invoices(deal_id);
CREATE INDEX idx_invoices_client  ON invoices(client_id);
CREATE INDEX idx_invoices_status  ON invoices(status_id);
CREATE INDEX idx_shipments_deal   ON shipments(deal_id);
CREATE INDEX idx_shipments_client ON shipments(client_id);
CREATE INDEX idx_receipts_supplier ON receipts(supplier_id);

-- Заявки
CREATE INDEX idx_leads_status ON leads(status_id);
CREATE INDEX idx_leads_source ON leads(source_id);
