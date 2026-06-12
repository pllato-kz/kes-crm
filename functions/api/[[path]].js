// ============================================================================
// KES CRM — единый REST API над D1/R2 (Cloudflare Pages Functions). Слои 2–3.
//
// Один catch-all обработчик на /api/* — чтобы не плодить десятки файлов-роутов.
// Бизнес-сущности обслуживаются обобщённым CRUD (таблица из белого списка +
// интроспекция колонок через PRAGMA), а каталог/сделки/клиенты/файлы — точечно.
//
// Безопасность SQL: имена таблиц берутся ТОЛЬКО из белого списка TABLES, все
// значения подставляются через .bind() (параметризованные запросы).
//
// Слой 3 — авторизация:
//   * POST /api/login — проверка пароля (PBKDF2) и выдача JWT (HS256).
//   * Все эндпоинты данных и мутации файлов требуют Bearer-токен.
//   * Пароли — PBKDF2-SHA256 + случайная соль (Web Crypto, без сторонних либ).
//   * Секрет подписи — env.JWT_SECRET (wrangler secret put JWT_SECRET), не в коде.
// ============================================================================

// Белый список таблиц: ресурс -> { pk, hide?, singleton? }
const TABLES = {
  // справочники
  roles:              { pk: 'key' },
  deal_stages:        { pk: 'id' },
  client_types:       { pk: 'key' },
  product_categories: { pk: 'id' },
  lead_sources:       { pk: 'id' },
  lead_statuses:      { pk: 'id' },
  warehouses:         { pk: 'id' },
  shipment_statuses:  { pk: 'id' },
  invoice_statuses:   { pk: 'id' },
  task_priorities:    { pk: 'id' },
  tags:               { pk: 'id' },
  // основные сущности
  company:            { pk: 'id', singleton: true },
  users:              { pk: 'id', hide: ['password_hash'] }, // хэш не отдаём и не пишем через общий CRUD
  clients:            { pk: 'id' },
  products:           { pk: 'id' },
  suppliers:          { pk: 'id' },
  deals:              { pk: 'id' },
  leads:              { pk: 'id' },
  tasks:              { pk: 'id' },
  invoices:           { pk: 'id' },
  shipments:          { pk: 'id' },
  receipts:           { pk: 'id' },
  notifications:      { pk: 'id' },
};

// Дружелюбные псевдонимы из словаря фронта -> имя таблицы
const ALIASES = {
  catalog: 'products',
  categories: 'product_categories',
  stages: 'deal_stages',
  'client-types': 'client_types',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
const err = (status, message) => json({ error: message }, status);
const genId = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);

// Колонки таблицы: [{ name, type, pk }]. Таблица — только из белого списка.
async function columns(env, table) {
  const r = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return r.results.map((c) => ({ name: c.name, type: String(c.type || '').toUpperCase(), pk: !!c.pk }));
}
const hide = (meta, row) => {
  if (row && meta && meta.hide) for (const h of meta.hide) delete row[h];
  return row;
};

// --------------------------------------------------------------------------
// Точка входа Pages Functions + гейт авторизации
// --------------------------------------------------------------------------
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const seg = path ? path.split('/') : [];

  try {
    // --- публичные эндпоинты ---
    if (seg.length === 0) return json({ ok: true, name: 'KES CRM API', resources: Object.keys(TABLES) });
    if (seg[0] === 'login' && request.method === 'POST') return loginRoute(env, request);

    // токен (если есть и валиден) -> payload, иначе null
    const auth = await authenticate(request, env);

    // синхронизация с 1С — только директор
    if (seg[0] === 'sync') {
      if (!auth) return err(401, 'Требуется авторизация');
      if (auth.role !== 'director') return err(403, 'Только директор может запускать синхронизацию');
      if (seg[1] === 'status' && request.method === 'GET') return syncStatus(env);
      if (seg[1] === '1c' && seg[2] === 'clients' && request.method === 'POST') return syncClients(env);
      if (seg[1] === '1c' && seg[2] === 'categories' && request.method === 'POST') return syncCategories(env);
      if (seg[1] === '1c' && seg[2] === 'stock' && request.method === 'POST') return syncStock(env);
      if (seg[1] === '1c' && seg[2] === 'products' && request.method === 'POST') {
        const u = new URL(request.url);
        const lim = parseInt(u.searchParams.get('limit'), 10);
        const skp = parseInt(u.searchParams.get('skip'), 10);
        return syncProducts(env, Number.isFinite(lim) ? lim : 1000, Number.isFinite(skp) ? skp : 0);
      }
      return err(404, 'Неизвестная синхронизация: ' + seg.join('/'));
    }

    // установка/смена пароля: первичная установка (хэш ещё null) разрешена без токена
    if (seg[0] === 'users' && seg[2] === 'password' && request.method === 'POST') {
      return setPasswordRoute(env, request, seg[1], auth);
    }

    // файлы: GET (отдача) — публичный; загрузка/удаление — только с токеном
    if (seg[0] === 'files') {
      if (request.method !== 'GET' && !auth) return err(401, 'Требуется авторизация');
      return filesRoute(context, seg.slice(1));
    }

    // данные: всё требует валидный токен
    if (!auth) return err(401, 'Требуется авторизация');

    // категории каталога с подсчётом товаров (для плиток)
    if (seg[0] === 'catalog' && seg[1] === 'categories' && request.method === 'GET') return catalogCategories(env);

    // управление пользователями (создание/изменение/удаление) — только директор
    const res = ALIASES[seg[0]] || seg[0];
    if (res === 'users' && request.method !== 'GET' && auth.role !== 'director') {
      return err(403, 'Только директор может управлять пользователями');
    }

    return dataRoute(context, seg, url, auth);
  } catch (e) {
    return err(500, e && e.message ? e.message : String(e));
  }
}

// --------------------------------------------------------------------------
// АВТОРИЗАЦИЯ
// --------------------------------------------------------------------------

// Достаём и проверяем Bearer-токен. Возвращает payload JWT или null.
async function authenticate(request, env) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m || !env.JWT_SECRET) return null;
  return verifyJWT(m[1], env.JWT_SECRET);
}

// POST /api/login { email, password } -> { token, user }
async function loginRoute(env, request) {
  if (!env.JWT_SECRET) return err(500, 'JWT_SECRET не задан (wrangler secret put JWT_SECRET)');
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return err(400, 'Нужны email и password');

  const user = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND active=1`).bind(email).first();
  // одинаковый ответ для «нет пользователя» и «неверный пароль» — не палим существование логина
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return err(401, 'Неверный логин или пароль');
  }
  const token = await signJWT({ sub: user.id, role: user.role_key, name: user.name }, env.JWT_SECRET);
  delete user.password_hash;
  return json({ token, user });
}

// POST /api/users/:id/password { password, current? }
// Первичная установка (password_hash == null) — без токена (онбординг после сидинга).
// Смена существующего — нужен токен: сам пользователь или директор.
async function setPasswordRoute(env, request, userId, auth) {
  const { password } = await request.json().catch(() => ({}));
  if (!password || String(password).length < 4) return err(400, 'Пароль слишком короткий (мин. 4 символа)');

  const user = await env.DB.prepare(`SELECT id, password_hash FROM users WHERE id=?`).bind(userId).first();
  if (!user) return err(404, 'Пользователь не найден');

  if (user.password_hash) {
    if (!auth) return err(401, 'Требуется авторизация');
    if (auth.sub !== userId && auth.role !== 'director') return err(403, 'Недостаточно прав');
  }
  const hash = await hashPassword(String(password), pbkdf2Iters(env));
  await env.DB.prepare(`UPDATE users SET password_hash=? WHERE id=?`).bind(hash, userId).run();
  return json({ ok: true, id: userId });
}

// --- Пароли: PBKDF2-SHA256 + случайная соль ---
const pbkdf2Iters = (env) => parseInt(env && env.PBKDF2_ITERATIONS, 10) || 100000;

async function pbkdf2Bits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
}
async function hashPassword(password, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = new Uint8Array(await pbkdf2Bits(password, salt, iterations));
  // формат: pbkdf2$<итерации>$<соль>$<хэш>  (base64url)
  return `pbkdf2$${iterations}$${b64uFromBytes(salt)}$${b64uFromBytes(bits)}`;
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, iterStr, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const salt = b64uToBytes(saltB64);
  const bits = new Uint8Array(await pbkdf2Bits(password, salt, parseInt(iterStr, 10)));
  return timingSafeEqual(bits, b64uToBytes(hashB64));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// --- JWT: HS256 (HMAC-SHA256) ---
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signJWT(payload, secret, ttlSec = 8 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64uFromStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64uFromStr(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const data = `${head}.${body}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data)));
  return `${data}.${b64uFromBytes(sig)}`;
}
async function verifyJWT(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64uToBytes(parts[2]), new TextEncoder().encode(data));
    if (!ok) return null;
    const payload = JSON.parse(b64uToStr(parts[1]));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null; // любой сбой разбора/декодирования = невалидный токен
  }
}

// --- base64url ---
function b64uFromBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uFromStr(str) { return b64uFromBytes(new TextEncoder().encode(str)); }
function b64uToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function b64uToStr(s) { return new TextDecoder().decode(b64uToBytes(s)); }

// --------------------------------------------------------------------------
// Данные (D1)
// --------------------------------------------------------------------------
async function dataRoute({ request, env }, seg, url, auth) {
  if (!env.DB) return err(500, 'D1 binding DB не настроен (см. wrangler.toml)');

  const resource = ALIASES[seg[0]] || seg[0];
  const meta = TABLES[resource];
  if (!meta) return err(404, `Неизвестный ресурс: ${seg[0]}`);
  const id = seg[1];
  const method = request.method;

  // --- точечная обработка ---
  if (resource === 'products' && id && seg[2] === 'stock') return productStock(env, request, id);
  if (resource === 'products' && method === 'GET' && !id) return listProducts(env, url);
  if (resource === 'deals' && id && seg[2] === 'history' && method === 'GET') return dealHistory(env, id);
  if (resource === 'deals' && method === 'GET' && id) return getDeal(env, id);
  if (resource === 'deals' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeDeal(env, request, method, id, auth);
  if (resource === 'clients' && method === 'GET') return id ? getClient(env, id) : listClients(env, url);
  if (resource === 'clients' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeClient(env, request, method, id);
  if (resource === 'leads' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeLead(env, request, method, id);

  // --- обобщённый CRUD ---
  switch (method) {
    case 'GET':
      return id ? getOne(env, resource, meta, id) : listGeneric(env, resource, meta, url);
    case 'POST':
      return createGeneric(env, resource, meta, request);
    case 'PUT':
    case 'PATCH':
      if (!id) return err(400, 'Нужен id в пути');
      return updateGeneric(env, resource, meta, id, request);
    case 'DELETE':
      if (!id) return err(400, 'Нужен id в пути');
      return deleteGeneric(env, resource, meta, id);
    default:
      return err(405, 'Метод не поддерживается');
  }
}

async function listGeneric(env, table, meta, url) {
  const limit = clampInt(url.searchParams.get('limit'), 500, 1, 1000);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1e9);
  const r = await env.DB.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).bind(limit, offset).all();
  return json(r.results.map((x) => hide(meta, x)));
}

async function getOne(env, table, meta, id) {
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${meta.pk}=?`).bind(id).first();
  if (!row) return err(404, 'Не найдено');
  return json(hide(meta, row));
}

async function createGeneric(env, table, meta, request) {
  const body = await request.json().catch(() => ({}));
  const cols = await columns(env, table);
  const names = cols.map((c) => c.name);
  const pkCol = cols.find((c) => c.name === meta.pk);
  const keys = Object.keys(body).filter((k) => names.includes(k) && !(meta.hide || []).includes(k));

  // авто-id для текстового первичного ключа, если не передан
  if (pkCol && !body[meta.pk] && !pkCol.type.includes('INT')) {
    body[meta.pk] = genId();
    if (!keys.includes(meta.pk)) keys.push(meta.pk);
  }
  if (!keys.length) return err(400, 'Пустое тело запроса');

  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const res = await env.DB.prepare(sql).bind(...keys.map((k) => body[k])).run();
  const newId = body[meta.pk] != null ? body[meta.pk] : res.meta && res.meta.last_row_id;
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${meta.pk}=?`).bind(newId).first();
  return json(hide(meta, row), 201);
}

async function updateGeneric(env, table, meta, id, request) {
  const body = await request.json().catch(() => ({}));
  const names = (await columns(env, table)).map((c) => c.name);
  const keys = Object.keys(body).filter(
    (k) => names.includes(k) && k !== meta.pk && !(meta.hide || []).includes(k)
  );
  if (!keys.length) return err(400, 'Нет полей для обновления');
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${meta.pk}=?`;
  await env.DB.prepare(sql).bind(...keys.map((k) => body[k]), id).run();
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${meta.pk}=?`).bind(id).first();
  if (!row) return err(404, 'Не найдено');
  return json(hide(meta, row));
}

async function deleteGeneric(env, table, meta, id) {
  const res = await env.DB.prepare(`DELETE FROM ${table} WHERE ${meta.pk}=?`).bind(id).run();
  return json({ deleted: (res.meta && res.meta.changes) || 0 });
}

// --------------------------------------------------------------------------
// Остатки товара по складам (product_stock, составной ключ)
// GET /api/products/:id/stock           — остатки по складам
// PUT /api/products/:id/stock {stock,reserved,warehouse_id?}  — upsert
// --------------------------------------------------------------------------
async function productStock(env, request, productId) {
  if (request.method === 'GET') {
    const r = await env.DB.prepare(
      `SELECT product_id, warehouse_id, stock, reserved FROM product_stock WHERE product_id=?`
    ).bind(productId).all();
    return json(r.results);
  }
  if (['PUT', 'POST', 'PATCH'].includes(request.method)) {
    const b = await request.json().catch(() => ({}));
    const warehouseId = b.warehouse_id || 'w1'; // мокап — один склад
    const stock = num(b.stock);
    const reserved = num(b.reserved);
    await env.DB.prepare(
      `INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?,?,?,?)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET stock=excluded.stock, reserved=excluded.reserved`
    ).bind(productId, warehouseId, stock, reserved).run();
    return json({ product_id: productId, warehouse_id: warehouseId, stock, reserved });
  }
  return err(405, 'Метод не поддерживается');
}

// --------------------------------------------------------------------------
// Каталог: поиск + фильтр + пагинация + остатки (на 1100+ SKU)
// GET /api/products?q=&category=&brand=&page=1&limit=50
// --------------------------------------------------------------------------
async function listProducts(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const cat = url.searchParams.get('category');
  const brand = url.searchParams.get('brand');
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 1000);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 1e9);
  const offset = (page - 1) * limit;

  const where = [];
  const args = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (cat) { where.push('p.category_id = ?'); args.push(cat); }
  if (brand) { where.push('p.brand = ?'); args.push(brand); }
  const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products p ${ws}`).bind(...args).first();
  const rows = await env.DB.prepare(
    `SELECT p.*, COALESCE(s.stock,0) AS stock, COALESCE(s.reserved,0) AS reserved
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(stock) AS stock, SUM(reserved) AS reserved
                    FROM product_stock GROUP BY product_id) s ON s.product_id = p.id
       ${ws}
       ORDER BY p.name
       LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();

  return json({ data: rows.results, total: total ? total.n : 0, page, limit });
}

// --------------------------------------------------------------------------
// Сделки: позиции (deal_items) вложены в объект сделки
// --------------------------------------------------------------------------
async function getDeal(env, id) {
  const deal = await env.DB.prepare(`SELECT * FROM deals WHERE id=?`).bind(id).first();
  if (!deal) return err(404, 'Сделка не найдена');
  const items = await env.DB.prepare(
    `SELECT id, product_id, qty, price_used FROM deal_items WHERE deal_id=?`
  ).bind(id).all();
  deal.lineItems = items.results;
  return json(deal);
}

async function writeDeal(env, request, method, id, auth) {
  const body = await request.json().catch(() => ({}));
  const dealId = id || body.id || genId();
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : null;

  // текущий этап до изменения (для истории)
  let prevStage = null;
  if (method !== 'POST') {
    const cur = await env.DB.prepare(`SELECT stage_id FROM deals WHERE id=?`).bind(dealId).first();
    prevStage = cur ? cur.stage_id : null;
  }

  const cols = (await columns(env, 'deals')).map((c) => c.name);
  const data = { ...body, id: dealId };
  // сумма и количество пересчитываются по позициям (как в мокапе)
  if (lineItems) {
    data.amount = lineItems.reduce((s, it) => s + num(it.qty) * num(it.price_used != null ? it.price_used : it.priceUsed), 0);
    data.items = lineItems.reduce((s, it) => s + num(it.qty), 0);
  }
  const keys = Object.keys(data).filter((k) => cols.includes(k));

  const stmts = [];
  if (method === 'POST') {
    stmts.push(
      env.DB.prepare(`INSERT INTO deals (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .bind(...keys.map((k) => data[k]))
    );
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) {
      stmts.push(
        env.DB.prepare(`UPDATE deals SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`)
          .bind(...up.map((k) => data[k]), dealId)
      );
    }
  }
  if (lineItems) {
    stmts.push(env.DB.prepare(`DELETE FROM deal_items WHERE deal_id=?`).bind(dealId));
    for (const it of lineItems) {
      const pid = it.product_id != null ? it.product_id : it.product;
      stmts.push(
        env.DB.prepare(`INSERT INTO deal_items (deal_id, product_id, qty, price_used) VALUES (?,?,?,?)`)
          .bind(dealId, pid, num(it.qty), num(it.price_used != null ? it.price_used : it.priceUsed))
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);

  // запись истории смены этапа
  const newStage = data.stage_id;
  const uid = auth && auth.sub;
  if (newStage) {
    if (method === 'POST') {
      await env.DB.prepare(`INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, user_id) VALUES (?,?,?,?)`).bind(dealId, null, newStage, uid).run();
    } else if (prevStage && newStage !== prevStage) {
      await env.DB.prepare(`INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, user_id) VALUES (?,?,?,?)`).bind(dealId, prevStage, newStage, uid).run();
    }
  }
  return getDeal(env, dealId);
}

// История смены этапов сделки
async function dealHistory(env, dealId) {
  const r = await env.DB.prepare(
    `SELECT h.from_stage, h.to_stage, h.user_id, h.changed_at, u.name AS user_name
       FROM deal_stage_history h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.deal_id = ? ORDER BY h.id DESC`
  ).bind(dealId).all();
  return json(r.results);
}

// --------------------------------------------------------------------------
// Клиенты: теги (many-to-many) вложены в объект клиента
// --------------------------------------------------------------------------
async function clientTags(env, id) {
  const r = await env.DB.prepare(
    `SELECT t.name FROM client_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.client_id=?`
  ).bind(id).all();
  return r.results.map((x) => x.name);
}

async function getClient(env, id) {
  const c = await env.DB.prepare(`SELECT * FROM clients WHERE id=?`).bind(id).first();
  if (!c) return err(404, 'Клиент не найден');
  c.tags = await clientTags(env, id);
  return json(c);
}

async function listClients(env, url) {
  const limit = clampInt(url.searchParams.get('limit'), 500, 1, 1000);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1e9);
  const manager = url.searchParams.get('manager');
  const where = [];
  const args = [];
  if (manager) { where.push('manager_id=?'); args.push(manager); }
  const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await env.DB.prepare(`SELECT * FROM clients ${ws} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();

  // теги одним запросом, без N+1
  const tagRows = await env.DB.prepare(
    `SELECT ct.client_id, t.name FROM client_tags ct JOIN tags t ON t.id = ct.tag_id`
  ).all();
  const byClient = {};
  for (const tr of tagRows.results) (byClient[tr.client_id] = byClient[tr.client_id] || []).push(tr.name);
  for (const c of rows.results) c.tags = byClient[c.id] || [];
  return json(rows.results);
}

async function writeClient(env, request, method, id) {
  const body = await request.json().catch(() => ({}));
  const clientId = id || body.id || genId();
  const cols = (await columns(env, 'clients')).map((c) => c.name);
  const data = { ...body, id: clientId };
  const keys = Object.keys(data).filter((k) => cols.includes(k));

  if (method === 'POST') {
    await env.DB.prepare(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .bind(...keys.map((k) => data[k])).run();
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) {
      await env.DB.prepare(`UPDATE clients SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`)
        .bind(...up.map((k) => data[k]), clientId).run();
    }
  }
  if (Array.isArray(body.tags)) await setClientTags(env, clientId, body.tags);
  return getClient(env, clientId);
}

async function setClientTags(env, clientId, names) {
  const stmts = [env.DB.prepare(`DELETE FROM client_tags WHERE client_id=?`).bind(clientId)];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    await env.DB.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).bind(name).run();
    const tag = await env.DB.prepare(`SELECT id FROM tags WHERE name=?`).bind(name).first();
    if (tag) stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO client_tags (client_id, tag_id) VALUES (?,?)`).bind(clientId, tag.id));
  }
  await env.DB.batch(stmts);
}

// --------------------------------------------------------------------------
// Заявки: источник приходит именем (source) — резолвим/создаём lead_source
// --------------------------------------------------------------------------
async function writeLead(env, request, method, id) {
  const body = await request.json().catch(() => ({}));
  const leadId = id || body.id || genId();

  if (body.source && !body.source_id) {
    await env.DB.prepare(`INSERT OR IGNORE INTO lead_sources (name) VALUES (?)`).bind(body.source).run();
    const src = await env.DB.prepare(`SELECT id FROM lead_sources WHERE name=?`).bind(body.source).first();
    if (src) body.source_id = src.id;
  }
  delete body.source;

  const cols = (await columns(env, 'leads')).map((c) => c.name);
  const data = { ...body, id: leadId };
  const keys = Object.keys(data).filter((k) => cols.includes(k));

  if (method === 'POST') {
    await env.DB.prepare(`INSERT INTO leads (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .bind(...keys.map((k) => data[k])).run();
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) {
      await env.DB.prepare(`UPDATE leads SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`)
        .bind(...up.map((k) => data[k]), leadId).run();
    }
  }
  const row = await env.DB.prepare(`SELECT * FROM leads WHERE id=?`).bind(leadId).first();
  return json(row, method === 'POST' ? 201 : 200);
}

// --------------------------------------------------------------------------
// Файлы (R2): загрузка / выдача / удаление
// POST   /api/files            (multipart, поле "file")
// GET    /api/files/<key...>
// DELETE /api/files/<key...>
// --------------------------------------------------------------------------
async function filesRoute({ request, env }, seg) {
  if (!env.BUCKET) return err(500, 'R2 binding BUCKET не настроен (см. wrangler.toml)');
  const method = request.method;
  const key = seg.join('/');

  if (method === 'POST') {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return err(400, 'Нет файла в поле "file"');
    const safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '_');
    const k = `uploads/${genId()}-${safe}`;
    await env.BUCKET.put(k, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    return json({ key: k, url: `/api/files/${k}`, size: file.size, type: file.type }, 201);
  }

  if (!key) return err(400, 'Не указан ключ файла');

  if (method === 'GET') {
    const obj = await env.BUCKET.get(key);
    if (!obj) return err(404, 'Файл не найден');
    const headers = new Headers(CORS);
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { headers });
  }

  if (method === 'DELETE') {
    await env.BUCKET.delete(key);
    return json({ deleted: key });
  }

  return err(405, 'Метод не поддерживается');
}

// --------------------------------------------------------------------------
// Синхронизация с 1С (OData). Креды — в секретах ODATA_URL/USER/PASSWORD.
// --------------------------------------------------------------------------
async function odataGet(env, path) {
  if (!env.ODATA_URL) throw new Error('ODATA_URL не задан (секрет)');
  const url = encodeURI(env.ODATA_URL.replace(/\/+$/, '') + '/' + path);
  const auth = 'Basic ' + btoa(`${env.ODATA_USER}:${env.ODATA_PASSWORD}`);
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error('1С OData ' + res.status + ' на ' + path.split('?')[0]);
  return res.json();
}

async function syncStatus(env) {
  const r = await env.DB.prepare('SELECT entity, last_at, info FROM sync_state').all();
  return json(r.results);
}

// Контрагенты 1С -> клиенты CRM. Идемпотентно по ext_ref (Ref_Key) и БИН.
async function syncClients(env) {
  const ex = await env.DB.prepare('SELECT id, ext_ref, bin FROM clients').all();
  const byRef = {}, byBin = {};
  for (const c of ex.results) { if (c.ext_ref) byRef[c.ext_ref] = c.id; if (c.bin) byBin[c.bin] = c.id; }

  const top = 1000;
  let skip = 0, fetched = 0, created = 0, updated = 0;
  const base = 'Catalog_Контрагенты?$format=json'
    + '&$filter=DeletionMark eq false and IsFolder eq false'
    + '&$orderby=Ref_Key'
    + '&$select=Ref_Key,Description,НаименованиеПолное,ИдентификационныйКодЛичности';

  while (true) {
    const data = await odataGet(env, `${base}&$top=${top}&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    fetched += rows.length;
    const stmts = [];
    for (const r of rows) {
      const ref = r.Ref_Key;
      const bin = String(r['ИдентификационныйКодЛичности'] || '').trim();
      const name = String(r.Description || r['НаименованиеПолное'] || '').trim();
      if (!ref || !name) continue;
      let id = byRef[ref] || (bin && byBin[bin]) || null;
      if (id) {
        stmts.push(env.DB.prepare('UPDATE clients SET name=?, bin=?, ext_ref=? WHERE id=?').bind(name, bin, ref, id));
        updated++;
      } else {
        id = genId();
        stmts.push(env.DB.prepare('INSERT INTO clients (id,name,bin,type_key,ext_ref,balance,ltv,email) VALUES (?,?,?,?,?,0,0,?)').bind(id, name, bin, 'opt', ref, '—'));
        created++;
      }
      byRef[ref] = id; if (bin) byBin[bin] = id;
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    if (rows.length < top) break;
    skip += top;
  }

  const info = `получено ${fetched}, новых ${created}, обновлено ${updated}`;
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('clients_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ fetched, created, updated });
}

// Номенклатура 1С (только товары, Услуга=false) -> товары CRM.
// Одна страница за вызов (limit ≤ 1000, со смещением skip) — фронт листает до done.
// Upsert по sku (=Code), без предзагрузки карт — масштабируется на тысячи позиций.
async function syncProducts(env, limit, skip) {
  const top = Math.min(Math.max(limit || 1000, 1), 1000);
  const off = Math.max(skip || 0, 0);
  const base = 'Catalog_Номенклатура?$format=json'
    + '&$filter=DeletionMark eq false and IsFolder eq false and Услуга eq false'
    + '&$orderby=Ref_Key'
    + '&$select=Ref_Key,Code,Артикул,Description,Parent_Key';

  const data = await odataGet(env, `${base}&$top=${top}&$skip=${off}`);
  const rows = data.value || [];
  const ZERO = '00000000-0000-0000-0000-000000000000';

  const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n;
  const stmts = [];
  let processed = 0;
  for (const r of rows) {
    const ref = r.Ref_Key;
    const sku = (String(r['Артикул'] || '').trim() || String(r.Code || '').trim() || ref);
    const name = String(r.Description || '').trim();
    if (!ref || !name) continue;
    const cat = r.Parent_Key && r.Parent_Key !== ZERO ? r.Parent_Key : null;
    processed++;
    stmts.push(env.DB.prepare(
      `INSERT INTO products (id, sku, name, unit, ext_ref, category_id) VALUES (?,?,?,?,?,?)
       ON CONFLICT(sku) DO UPDATE SET name=excluded.name, ext_ref=excluded.ext_ref, category_id=excluded.category_id`
    ).bind(genId(), sku, name, 'шт', ref, cat));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const after = (await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n;
  const created = after - before;
  const updated = processed - created;
  const done = rows.length < top;

  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('products_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(`обработано до ${off + rows.length}` + (done ? ' (готово)' : ' (идёт…)')).run();

  return json({ fetched: rows.length, created, updated, next: off + rows.length, done });
}

// Папки номенклатуры 1С -> категории товаров (id = Ref_Key папки)
async function syncCategories(env) {
  let skip = 0, fetched = 0, upserted = 0;
  const base = 'Catalog_Номенклатура?$format=json'
    + '&$filter=DeletionMark eq false and IsFolder eq true'
    + '&$orderby=Ref_Key&$select=Ref_Key,Description';
  while (true) {
    const data = await odataGet(env, `${base}&$top=1000&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    const stmts = [];
    for (const r of rows) {
      const id = r.Ref_Key, name = String(r.Description || '').trim();
      if (!id || !name) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO product_categories (id, name, icon) VALUES (?,?,'📁')
         ON CONFLICT(id) DO UPDATE SET name=excluded.name`
      ).bind(id, name));
      upserted++;
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    fetched += rows.length;
    if (rows.length < 1000) break;
    skip += rows.length;
  }
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('categories_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(`категорий ${upserted}`).run();
  return json({ fetched, upserted });
}

// Остатки 1С (агрегированный баланс по номенклатуре) -> product_stock (склад w1).
async function syncStock(env) {
  const prods = await env.DB.prepare('SELECT id, ext_ref FROM products WHERE ext_ref IS NOT NULL').all();
  const byRef = {};
  for (const p of prods.results) byRef[p.ext_ref] = p.id;

  const data = await odataGet(env, "AccumulationRegister_ТоварыНаВиртуальныхСкладах/Balance(Dimensions='Номенклатура')?$format=json");
  const rows = data.value || [];
  let updated = 0, missing = 0;
  const stmts = [];
  for (const r of rows) {
    if (!String(r['Номенклатура_Type'] || '').endsWith('Catalog_Номенклатура')) continue; // пропускаем ОС и пр.
    const ref = r['Номенклатура'];
    const qty = Number(r['КоличествоBalance'] || 0);
    const pid = byRef[ref];
    if (!pid) { missing++; continue; }
    stmts.push(env.DB.prepare(
      `INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?, 'w1', ?, 0)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET stock=excluded.stock`
    ).bind(pid, qty));
    updated++;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('stock_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(`позиций с остатком ${updated}, не сопоставлено ${missing}`).run();
  return json({ rows: rows.length, updated, missing });
}

// Категории каталога с числом товаров (только непустые) — для плиток каталога
async function catalogCategories(env) {
  const r = await env.DB.prepare(
    `SELECT c.id, c.name, c.icon, COUNT(p.id) AS count
       FROM product_categories c JOIN products p ON p.category_id = c.id
      GROUP BY c.id, c.name, c.icon HAVING count > 0 ORDER BY c.name`
  ).all();
  return json(r.results);
}

// --------------------------------------------------------------------------
// Утилиты
// --------------------------------------------------------------------------
function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
