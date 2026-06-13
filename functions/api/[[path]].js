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
  pipelines:          { pk: 'id' },
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
    if (seg[0] === 'login' && request.method === 'POST') return await loginRoute(env, request);

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
      if (seg[1] === '1c' && seg[2] === 'receipts' && request.method === 'POST') return syncReceipts(env);
      if (seg[1] === '1c' && seg[2] === 'prices' && request.method === 'POST') {
        const mode = new URL(request.url).searchParams.get('mode');
        return syncPrices(env, mode === 'avg' ? 'avg' : 'last');
      }
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

    // сводка по складу (для карточек: SKU, единиц, резерв, стоимость)
    if (seg[0] === 'warehouse' && seg[1] === 'summary' && request.method === 'GET') return warehouseSummary(env);

    // агрегаты для раздела «Отчёты» (всё из данных CRM)
    if (seg[0] === 'reports' && seg[1] === 'summary' && request.method === 'GET') return reportsSummary(env, url);

    // интеграция WhatsApp через Green API (сообщения по сделке/клиенту)
    if (seg[0] === 'greenapi') {
      if (seg[1] === 'status' && request.method === 'GET') return greenapiStatus(env);
      if (seg[1] === 'send' && request.method === 'POST') return greenapiSend(env, request, auth);
      if (seg[1] === 'messages' && request.method === 'GET') return greenapiMessages(env, url);
      return err(404, 'Неизвестный метод Green API');
    }

    // инвентаризация склада (лист пересчёта → проведение → корректировка остатков)
    if (seg[0] === 'inventory') {
      await ensureInventorySchema(env);
      const canStock = auth.role === 'director' || auth.role === 'warehouse';
      const id = seg[1];
      if (!id) {
        if (request.method === 'GET') return inventoryList(env);
        if (request.method === 'POST') return canStock ? inventoryCreate(env, request, auth) : err(403, 'Недостаточно прав для инвентаризации');
      } else if (seg[2] === 'items' && request.method === 'PUT') {
        return canStock ? inventorySaveItems(env, id, request) : err(403, 'Недостаточно прав');
      } else if (seg[2] === 'post' && request.method === 'POST') {
        return canStock ? inventoryPost(env, id) : err(403, 'Недостаточно прав');
      } else if (request.method === 'GET') {
        return inventoryGet(env, id);
      }
      return err(405, 'Метод не поддерживается');
    }

    // управление пользователями (создание/изменение/удаление) — только директор
    const res = ALIASES[seg[0]] || seg[0];
    if (res === 'users' && request.method !== 'GET' && auth.role !== 'director') {
      return err(403, 'Только директор может управлять пользователями');
    }

    return await dataRoute(context, seg, url, auth);
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

  // задачи: расширенные поля (описание/дата начала/статус/комментарии) — добавляем на лету
  if (resource === 'tasks') await ensureTaskColumns(env);
  if (resource === 'deals') await ensureDealColumns(env);
  if (['pipelines', 'deal_stages', 'deals'].includes(resource)) await ensurePipelineSchema(env);

  // изменять роли (матрицу доступа) может только директор
  if (resource === 'roles' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!auth || auth.role !== 'director') return err(403, 'Менять доступы по ролям может только директор');
  }
  // управлять этапами воронки может только директор; защищённые этапы (protected) нельзя менять/удалять
  if (resource === 'deal_stages' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!auth || auth.role !== 'director') return err(403, 'Только директор может управлять этапами');
    if (['PUT', 'PATCH', 'DELETE'].includes(method) && id) {
      const st = await env.DB.prepare('SELECT protected FROM deal_stages WHERE id=?').bind(id).first();
      if (st && st.protected) return err(403, 'Этот этап нельзя изменять или удалять');
    }
    if (method === 'DELETE' && id) return deleteStage(env, id);
  }
  // управлять воронками может только директор
  if (resource === 'pipelines' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!auth || auth.role !== 'director') return err(403, 'Только директор может управлять воронками');
    if (method === 'POST' && !id) return createPipeline(env, request);
    if (method === 'DELETE' && id) return deletePipeline(env, id);
  }

  // --- точечная обработка ---
  if (resource === 'products' && id && seg[2] === 'stock') return productStock(env, request, id);
  if (resource === 'products' && method === 'GET' && !id) return listProducts(env, url);
  if (resource === 'deals' && id && seg[2] === 'history' && method === 'GET') return dealHistory(env, id);
  if (resource === 'deals' && method === 'GET' && id) return getDeal(env, id);
  if (resource === 'deals' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeDeal(env, request, method, id, auth);
  if (resource === 'deals' && method === 'DELETE' && id) return deleteDeal(env, id, auth);
  if (resource === 'clients' && method === 'GET') return id ? getClient(env, id) : listClients(env, url);
  if (resource === 'clients' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeClient(env, request, method, id);
  if (resource === 'leads' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeLead(env, request, method, id);
  if (resource === 'notifications' && id === 'scan-overdue' && method === 'POST') return scanOverdueTasks(env);
  if (resource === 'notifications' && method === 'GET' && !id) return listNotifications(env, auth);

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
  const lowRaw = url.searchParams.get('lowstock');
  const low = (lowRaw != null && lowRaw !== '') ? clampInt(lowRaw, 50, 0, 1e9) : null;
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 1000);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 1e9);
  const offset = (page - 1) * limit;

  const stockJoin =
    `LEFT JOIN (SELECT product_id, SUM(stock) AS stock, SUM(reserved) AS reserved
                  FROM product_stock GROUP BY product_id) s ON s.product_id = p.id`;

  const where = [];
  const args = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (cat) { where.push('p.category_id = ?'); args.push(cat); }
  if (brand) { where.push('p.brand = ?'); args.push(brand); }
  if (low != null) { where.push('(COALESCE(s.stock,0) - COALESCE(s.reserved,0)) < ?'); args.push(low); }
  const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // join в COUNT нужен только когда фильтруем по остатку
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p ${low != null ? stockJoin : ''} ${ws}`
  ).bind(...args).first();

  const order = low != null ? '(COALESCE(s.stock,0) - COALESCE(s.reserved,0)) ASC' : 'p.name';
  const rows = await env.DB.prepare(
    `SELECT p.*, COALESCE(s.stock,0) AS stock, COALESCE(s.reserved,0) AS reserved
       FROM products p
       ${stockJoin}
       ${ws}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();

  return json({ data: rows.results, total: total ? total.n : 0, page, limit });
}

// Расширенные поля задачи (добавляются на лету, один раз на изолят).
let TASKS_SCHEMA_OK = false;
async function ensureTaskColumns(env) {
  if (TASKS_SCHEMA_OK) return;
  for (const ddl of [
    'ALTER TABLE tasks ADD COLUMN description TEXT',
    'ALTER TABLE tasks ADD COLUMN start_date TEXT',
    'ALTER TABLE tasks ADD COLUMN status TEXT',
    'ALTER TABLE tasks ADD COLUMN comments TEXT',
  ]) { try { await env.DB.prepare(ddl).run(); } catch (e) { /* уже есть */ } }
  TASKS_SCHEMA_OK = true;
}

// Доп. поля сделки: со-ответственный менеджер + комментарии.
let DEALS_SCHEMA_OK = false;
async function ensureDealColumns(env) {
  if (DEALS_SCHEMA_OK) return;
  for (const ddl of [
    'ALTER TABLE deals ADD COLUMN co_manager_id TEXT',
    'ALTER TABLE deals ADD COLUMN comments TEXT',
    'ALTER TABLE deals ADD COLUMN address TEXT',
  ]) { try { await env.DB.prepare(ddl).run(); } catch (e) { /* уже есть */ } }
  DEALS_SCHEMA_OK = true;
}

// Воронки продаж: таблица pipelines + колонка pipeline_id у этапов.
// Создаётся на лету (wrangler-миграции в этом окружении недоступны).
let PIPELINES_SCHEMA_OK = false;
async function ensurePipelineSchema(env) {
  if (PIPELINES_SCHEMA_OK) return;
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY, name TEXT, sort INTEGER)').run(); } catch (e) {}
  try { await env.DB.prepare('ALTER TABLE deal_stages ADD COLUMN pipeline_id TEXT').run(); } catch (e) { /* уже есть */ }
  try { await env.DB.prepare('ALTER TABLE deal_stages ADD COLUMN protected INTEGER DEFAULT 0').run(); } catch (e) { /* уже есть */ }
  // защищённые этапы основной воронки (нельзя переименовать/удалить)
  try { await env.DB.prepare("UPDATE deal_stages SET protected=1 WHERE id IN ('paid','shipped','lost')").run(); } catch (e) {}
  // дефолтная воронка, если ни одной нет — в неё попадают существующие этапы
  try {
    const cnt = (await env.DB.prepare('SELECT COUNT(*) AS n FROM pipelines').first()).n;
    if (!cnt) await env.DB.prepare("INSERT INTO pipelines (id, name, sort) VALUES ('default', 'Основная воронка', 0)").run();
  } catch (e) {}
  // привязываем «бесхозные» этапы к дефолтной воронке
  try { await env.DB.prepare("UPDATE deal_stages SET pipeline_id='default' WHERE pipeline_id IS NULL OR pipeline_id=''").run(); } catch (e) {}
  PIPELINES_SCHEMA_OK = true;
}

// Создание воронки + стартовый набор этапов
async function createPipeline(env, request) {
  const body = await request.json().catch(() => ({}));
  const id = genId();
  const name = String(body.name || 'Новая воронка').trim() || 'Новая воронка';
  const row = await env.DB.prepare('SELECT MAX(sort) AS m FROM pipelines').first();
  const sort = (row && row.m != null ? row.m : 0) + 1;
  await env.DB.prepare('INSERT INTO pipelines (id, name, sort) VALUES (?,?,?)').bind(id, name, sort).run();
  // стандартный набор этапов — как в основной воронке; Оплачено/Отгружено/Отказ защищены
  const starter = [
    ['Новая', '#9CA3AF', 0], ['КП отправлено', '#3B82F6', 0], ['Согласовано', '#8B5CF6', 0],
    ['Счёт выставлен', '#F59E0B', 0], ['Оплачено', '#10B981', 1], ['Отгружено', '#06B6D4', 1],
    ['Закрыта', '#22C55E', 0], ['Отказ', '#EF4444', 1],
  ];
  let i = 0;
  for (const [label, color, prot] of starter) {
    await env.DB.prepare('INSERT INTO deal_stages (id, label, color, sort, pipeline_id, protected) VALUES (?,?,?,?,?,?)')
      .bind(genId(), label, color, i++, id, prot).run();
  }
  return json({ id, name, sort }, 201);
}

// Удаление воронки: её сделки переносятся на первый этап другой воронки, этапы удаляются
async function deletePipeline(env, id) {
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM pipelines').first()).n;
  if (total <= 1) return err(400, 'Нельзя удалить единственную воронку');
  const fallback = await env.DB.prepare('SELECT id FROM pipelines WHERE id<>? ORDER BY sort, id LIMIT 1').bind(id).first();
  if (!fallback) return err(400, 'Нет запасной воронки для переноса сделок');
  const fstage = await env.DB.prepare('SELECT id FROM deal_stages WHERE pipeline_id=? ORDER BY sort, id LIMIT 1').bind(fallback.id).first();
  if (fstage) {
    await env.DB.prepare('UPDATE deals SET stage_id=? WHERE stage_id IN (SELECT id FROM deal_stages WHERE pipeline_id=?)')
      .bind(fstage.id, id).run();
  }
  await env.DB.prepare('DELETE FROM deal_stages WHERE pipeline_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM pipelines WHERE id=?').bind(id).run();
  return json({ deleted: 1, reassignedTo: fallback.id });
}

// Уведомления — адресные (user_id) + широковещательные (user_id IS NULL).
// Колонки user_id/ref добавляются на лету; ref — для идемпотентности (UNIQUE).
async function ensureNotifSchema(env) {
  for (const ddl of ['ALTER TABLE notifications ADD COLUMN user_id TEXT', 'ALTER TABLE notifications ADD COLUMN ref TEXT']) {
    try { await env.DB.prepare(ddl).run(); } catch (e) { /* колонка уже есть */ }
  }
  try { await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_ref ON notifications(ref)').run(); } catch (e) {}
}

async function listNotifications(env, auth) {
  await ensureNotifSchema(env);
  const uid = auth ? auth.sub : null;
  const r = await env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(uid).all();
  return json(r.results);
}

// Сканирует просроченные задачи и шлёт уведомление ответственному + всем директорам.
// Идемпотентно (ref = overdue:<taskId>:<userId>); снимает уведомления по задачам,
// которые уже не просрочены/выполнены.
async function scanOverdueTasks(env) {
  await ensureNotifSchema(env);
  const dirs = await env.DB.prepare("SELECT id FROM users WHERE role_key='director' AND active=1").all();
  const directorIds = dirs.results.map((d) => d.id);
  const tasks = await env.DB.prepare("SELECT id, title, owner_id, due FROM tasks WHERE done=0 AND due IS NOT NULL AND due <> ''").all();

  const now = Date.now();
  const overdueIds = new Set();
  const stmts = [];
  for (const t of tasks.results) {
    const dt = new Date(String(t.due).replace(' ', 'T'));
    if (isNaN(dt.getTime()) || dt.getTime() >= now) continue; // не просрочена
    overdueIds.add(String(t.id));
    const recipients = new Set(directorIds);
    if (t.owner_id) recipients.add(t.owner_id);
    for (const uid of recipients) {
      stmts.push(env.DB.prepare(
        "INSERT OR IGNORE INTO notifications (text, type, read, created_at, user_id, ref) VALUES (?, 'error', 0, datetime('now'), ?, ?)"
      ).bind(`Просрочена задача: ${t.title}`, uid, `overdue:${t.id}:${uid}`));
    }
  }
  // уборка устаревших overdue-уведомлений (задача выполнена/перенесена)
  const existing = await env.DB.prepare("SELECT id, ref FROM notifications WHERE ref LIKE 'overdue:%'").all();
  for (const n of existing.results) {
    const taskId = String(n.ref).split(':')[1];
    if (!overdueIds.has(taskId)) stmts.push(env.DB.prepare('DELETE FROM notifications WHERE id=?').bind(n.id));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return json({ overdue: overdueIds.size });
}

// --------------------------------------------------------------------------
// Green API (WhatsApp) — интеграция для раздела «Сделки».
//   Секреты: GREENAPI_INSTANCE, GREENAPI_TOKEN (wrangler pages secret put).
//   Лог сообщений — таблица messages (создаётся на лету).
// --------------------------------------------------------------------------
async function ensureMessagesSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    deal_id TEXT,
    client_id TEXT,
    phone TEXT,
    direction TEXT,
    channel TEXT,
    text TEXT,
    status TEXT,
    ext_id TEXT,
    user_id TEXT,
    created_at TEXT
  )`).run();
}

// Номер телефона -> chatId Green API (формат <digits>@c.us). Нормализуем KZ-номера.
function toChatId(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) d = '7' + d;            // 7012345678 -> 77012345678
  else if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); // 8XXX -> 7XXX
  if (d.length < 11) return null;
  return d + '@c.us';
}

function greenapiCreds(env) {
  return { inst: env.GREENAPI_INSTANCE, tok: env.GREENAPI_TOKEN, base: (env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/+$/, '') };
}

async function greenapiStatus(env) {
  const { inst, tok } = greenapiCreds(env);
  return json({ configured: !!(inst && tok) });
}

async function greenapiMessages(env, url) {
  await ensureMessagesSchema(env);
  const dealId = url.searchParams.get('dealId');
  const clientId = url.searchParams.get('clientId');
  const where = [], args = [];
  if (dealId) { where.push('deal_id=?'); args.push(dealId); }
  if (clientId) { where.push('client_id=?'); args.push(clientId); }
  const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const r = await env.DB.prepare(`SELECT * FROM messages ${ws} ORDER BY created_at DESC LIMIT 50`).bind(...args).all();
  return json(r.results);
}

// Отправка WhatsApp-сообщения по сделке/клиенту через Green API + лог.
async function greenapiSend(env, request, auth) {
  await ensureMessagesSchema(env);
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || '').trim();
  if (!text) return err(400, 'Пустое сообщение');

  let phone = b.phone || null;
  let clientId = b.clientId || null;
  const dealId = b.dealId || null;

  if ((!phone || !clientId) && dealId) {
    const d = await env.DB.prepare(
      'SELECT c.id AS cid, c.phone AS phone FROM deals dd LEFT JOIN clients c ON c.id = dd.client_id WHERE dd.id=?'
    ).bind(dealId).first();
    if (d) { phone = phone || d.phone; clientId = clientId || d.cid; }
  }
  if (!phone && clientId) {
    const c = await env.DB.prepare('SELECT phone FROM clients WHERE id=?').bind(clientId).first();
    phone = c && c.phone;
  }

  const chatId = toChatId(phone);
  if (!chatId) return err(400, 'У клиента не указан корректный номер телефона');

  const { inst, tok, base } = greenapiCreds(env);
  if (!inst || !tok) {
    return err(503, 'Green API не настроен: задайте секреты GREENAPI_INSTANCE и GREENAPI_TOKEN');
  }

  let status = 'sent', extId = null, errMsg = null;
  try {
    const res = await fetch(`${base}/waInstance${inst}/sendMessage/${tok}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, message: text }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { status = 'error'; errMsg = 'Green API ' + res.status + (data && data.message ? ': ' + data.message : ''); }
    else extId = (data && data.idMessage) || null;
  } catch (e) { status = 'error'; errMsg = String((e && e.message) || e); }

  const id = genId();
  await env.DB.prepare(
    `INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).bind(id, dealId, clientId, String(phone), 'out', 'whatsapp', text, status, extId, auth && auth.sub).run();

  if (status === 'error') return err(502, errMsg || 'Не удалось отправить сообщение');
  return json({ ok: true, id, idMessage: extId, chatId });
}

// Агрегаты раздела «Отчёты» — считаются в SQL по данным CRM (сделки/позиции).
// «Выигранные» сделки: этапы paid/shipped/closed.
async function reportsSummary(env, url) {
  const WON = "('paid','shipped','closed')";
  const p = (url && url.searchParams) || new URLSearchParams();
  const manager = (p.get('manager') || '').trim();
  const from = (p.get('from') || '').trim();
  const to = (p.get('to') || '').trim();
  const stages = (p.get('stages') || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Конструктор условий WHERE с учётом фильтров (менеджер, диапазон дат, этапы).
  //   alias — префикс таблицы deals ('' или 'd'); mode 'won' добавляет фильтр выигранных,
  //   если этапы не выбраны; mode 'all' — без этого ограничения.
  const condsFor = (alias, mode) => {
    const col = (c) => (alias ? `${alias}.${c}` : c);
    const conds = [];
    const args = [];
    if (manager) { conds.push(`${col('manager_id')} = ?`); args.push(manager); }
    if (from) { conds.push(`substr(${col('created')},1,10) >= ?`); args.push(from); }
    if (to) { conds.push(`substr(${col('created')},1,10) <= ?`); args.push(to); }
    if (stages.length) {
      conds.push(`${col('stage_id')} IN (${stages.map(() => '?').join(',')})`);
      args.push(...stages);
    } else if (mode === 'won') {
      conds.push(`${col('stage_id')} IN ${WON}`);
    }
    return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', args };
  };

  const cStage = condsFor('', 'all');
  const byStage = await env.DB.prepare(
    `SELECT stage_id, COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum FROM deals ${cStage.where} GROUP BY stage_id`
  ).bind(...cStage.args).all();

  const cMgr = condsFor('', 'won');
  const byManager = await env.DB.prepare(
    `SELECT manager_id, COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum
       FROM deals ${cMgr.where} GROUP BY manager_id`
  ).bind(...cMgr.args).all();

  const cCat = condsFor('d', 'won');
  const byCategory = await env.DB.prepare(
    `SELECT COALESCE(c.name,'Без категории') AS category, COALESCE(SUM(di.qty * di.price_used),0) AS sum
       FROM deal_items di
       JOIN deals d ON d.id = di.deal_id
       LEFT JOIN products p ON p.id = di.product_id
       LEFT JOIN product_categories c ON c.id = p.category_id
      ${cCat.where}
      GROUP BY c.name HAVING sum > 0 ORDER BY sum DESC`
  ).bind(...cCat.args).all();

  const cMon = condsFor('', 'won');
  const monWhere = cMon.where
    ? `${cMon.where} AND created IS NOT NULL AND created <> ''`
    : `WHERE created IS NOT NULL AND created <> ''`;
  const byMonth = await env.DB.prepare(
    `SELECT substr(created,1,7) AS month, COALESCE(SUM(amount),0) AS sum
       FROM deals ${monWhere}
      GROUP BY month ORDER BY month DESC LIMIT 6`
  ).bind(...cMon.args).all();

  return json({
    byStage: byStage.results,
    byManager: byManager.results,
    byCategory: byCategory.results,
    byMonth: byMonth.results.reverse(), // хронологически
  });
}

// Сводка по складу: всего SKU, единиц на остатке, в резерве, стоимость (по закупу).
async function warehouseSummary(env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS sku,
            COALESCE(SUM(s.stock), 0) AS units,
            COALESCE(SUM(s.reserved), 0) AS reserved,
            COALESCE(SUM(s.stock * p.price_cost), 0) AS value
       FROM products p
       LEFT JOIN (SELECT product_id, SUM(stock) AS stock, SUM(reserved) AS reserved
                    FROM product_stock GROUP BY product_id) s ON s.product_id = p.id`
  ).first();
  return json(r || { sku: 0, units: 0, reserved: 0, value: 0 });
}

// --------------------------------------------------------------------------
// Удаление сделки: отвязываем счета/отгрузки/задачи, чистим позиции и историю.
// Доступ: только директор.
async function deleteDeal(env, id, auth) {
  const d = await env.DB.prepare(`SELECT id, manager_id FROM deals WHERE id=?`).bind(id).first();
  if (!d) return err(404, 'Сделка не найдена');
  if (auth.role !== 'director') return err(403, 'Удалять сделки может только директор');
  await env.DB.batch([
    env.DB.prepare(`UPDATE invoices SET deal_id=NULL WHERE deal_id=?`).bind(id),
    env.DB.prepare(`UPDATE shipments SET deal_id=NULL WHERE deal_id=?`).bind(id),
    env.DB.prepare(`UPDATE tasks SET deal_id=NULL WHERE deal_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM deal_items WHERE deal_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM deal_stage_history WHERE deal_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM deals WHERE id=?`).bind(id),
  ]);
  return json({ deleted: 1, id });
}

// Удаление этапа воронки: сделки этого этапа переносим на другой этап (по сортировке).
async function deleteStage(env, id) {
  const cur = await env.DB.prepare('SELECT pipeline_id FROM deal_stages WHERE id=?').bind(id).first();
  const pid = cur ? (cur.pipeline_id || 'default') : 'default';
  // запасной этап — из той же воронки
  const fallback = await env.DB.prepare('SELECT id FROM deal_stages WHERE id<>? AND pipeline_id=? ORDER BY sort, id LIMIT 1').bind(id, pid).first();
  if (!fallback) return err(400, 'Нельзя удалить последний этап воронки');
  await env.DB.prepare('UPDATE deals SET stage_id=? WHERE stage_id=?').bind(fallback.id, id).run();
  await env.DB.prepare('DELETE FROM deal_stages WHERE id=?').bind(id).run();
  return json({ deleted: 1, reassignedTo: fallback.id });
}

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
  // авто-номер сделки на сервере (уникальный) — чтобы не было коллизий UNIQUE(no)
  if (method === 'POST') {
    const yr = new Date().getFullYear();
    const last = await env.DB.prepare("SELECT no FROM deals WHERE no GLOB ? ORDER BY no DESC LIMIT 1").bind(yr + '-*').first();
    let next = 1;
    if (last && last.no) { const mm = String(last.no).match(/(\d+)\s*$/); if (mm) next = parseInt(mm[1], 10) + 1; }
    data.no = `${yr}-${String(next).padStart(4, '0')}`;
  }
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

// Последние приходы из 1С (Document_ПоступлениеТоваровУслуг) -> таблица receipts.
// Поставщик denormalized в supplier_name (имя контрагента из уже синхр. clients).
// Снимок последних N приходов: чистим прежний импорт (ext_ref NOT NULL) и пишем заново.
async function ensureReceiptColumns(env) {
  for (const ddl of [
    'ALTER TABLE receipts ADD COLUMN ext_ref TEXT',
    'ALTER TABLE receipts ADD COLUMN supplier_name TEXT',
  ]) {
    try { await env.DB.prepare(ddl).run(); } catch (e) { /* колонка уже есть — ок */ }
  }
}

async function syncReceipts(env) {
  await ensureReceiptColumns(env);
  const LIMIT = 200; // «последние приходы» — берём свежие по дате

  // имя контрагента по Ref_Key (контрагенты лежат в clients после syncClients)
  const cl = await env.DB.prepare('SELECT ext_ref, name FROM clients WHERE ext_ref IS NOT NULL').all();
  const nameByRef = {};
  for (const c of cl.results) nameByRef[c.ext_ref] = c.name;

  // число позиций по документу: считаем по табличной части Товары (страницы по 10000)
  const lineCount = {};
  let skip = 0;
  const lbase = 'Document_ПоступлениеТоваровУслуг_Товары?$format=json&$orderby=Ref_Key&$select=Ref_Key';
  while (true) {
    const data = await odataGet(env, `${lbase}&$top=10000&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    for (const r of rows) lineCount[r.Ref_Key] = (lineCount[r.Ref_Key] || 0) + 1;
    if (rows.length < 10000) break;
    skip += 10000;
  }

  // свежие шапки приходов
  const hbase = 'Document_ПоступлениеТоваровУслуг?$format=json'
    + '&$orderby=Date desc'
    + '&$select=Ref_Key,Number,Date,Контрагент_Key,СуммаДокумента,Posted,Комментарий';
  const data = await odataGet(env, `${hbase}&$top=${LIMIT}`);
  const rows = data.value || [];

  // чистим прежний импорт из 1С (ручные/seed приходы с ext_ref IS NULL не трогаем)
  await env.DB.prepare('DELETE FROM receipts WHERE ext_ref IS NOT NULL').run();

  const usedNo = {};
  const stmts = [];
  for (const r of rows) {
    const ref = r.Ref_Key;
    if (!ref) continue;
    let no = String(r.Number || '').trim() || ref.slice(0, 8);
    if (usedNo[no]) no = no + '·' + ref.slice(0, 4); // обходим UNIQUE(no)
    usedNo[no] = 1;
    const date = String(r.Date || '').slice(0, 10);
    const amount = Math.round(Number(r['СуммаДокумента'] || 0));
    const status = r.Posted ? 'оприходовано' : 'черновик';
    const supplierName = nameByRef[r['Контрагент_Key']] || '—';
    const note = String(r['Комментарий'] || '').trim();
    const items = lineCount[ref] || 0;
    stmts.push(env.DB.prepare(
      `INSERT INTO receipts (id, no, supplier_id, date, items, amount, status, note, ext_ref, supplier_name)
       VALUES (?,?,NULL,?,?,?,?,?,?,?)`
    ).bind(ref, no, date, items, amount, status, note, ref, supplierName));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const info = `импортировано ${stmts.length} (последние по дате)`;
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('receipts_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ fetched: rows.length, imported: stmts.length });
}

// Цены из приходов 1С -> закупочная цена товара (products.price_cost).
//   mode='last' (по умолчанию): цена из ПОСЛЕДНЕГО по дате прихода прихода по номенклатуре;
//   mode='avg': среднее значение цены по всем приходам номенклатуры.
// Документ Поступление и его табл. часть Товары идут отдельными OData-сущностями,
// $expand табличной части 1С не поддерживает (501), поэтому шапки и строки
// тянем порознь и соединяем по ссылке (Ref_Key) в памяти.
// Цену нормируем к базовой единице: Цена / Коэффициент (как остатки в регистре).
async function syncPrices(env, mode) {
  const isAvg = mode === 'avg';
  const TOP = 10000;

  // карта товаров: Ref_Key номенклатуры -> id товара
  const prods = await env.DB.prepare('SELECT id, ext_ref FROM products WHERE ext_ref IS NOT NULL').all();
  const byRef = {};
  for (const p of prods.results) byRef[p.ext_ref] = p.id;

  // 1) шапки приходов: Ref_Key -> дата (ISO-строка, сравнима лексикографически)
  const dateByDoc = {};
  let skip = 0, docs = 0;
  const hbase = 'Document_ПоступлениеТоваровУслуг?$format=json'
    + '&$orderby=Ref_Key&$select=Ref_Key,Date';
  while (true) {
    const data = await odataGet(env, `${hbase}&$top=${TOP}&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    for (const r of rows) dateByDoc[r.Ref_Key] = String(r.Date || '');
    docs += rows.length;
    if (rows.length < TOP) break;
    skip += TOP;
  }

  // 2) строки приходов: агрегируем цену по номенклатуре
  //    last: { date, price };  avg: { sum, count }
  const agg = {};
  let lines = 0;
  skip = 0;
  const lbase = 'Document_ПоступлениеТоваровУслуг_Товары?$format=json'
    + '&$orderby=Ref_Key,LineNumber'
    + '&$select=Ref_Key,Номенклатура_Key,Цена,Коэффициент';
  while (true) {
    const data = await odataGet(env, `${lbase}&$top=${TOP}&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    for (const r of rows) {
      lines++;
      const nk = r['Номенклатура_Key'];
      if (!nk) continue;
      const coef = Number(r['Коэффициент']) || 1;
      const price = Number(r['Цена']) / (coef > 0 ? coef : 1);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (isAvg) {
        const a = agg[nk] || (agg[nk] = { sum: 0, count: 0 });
        a.sum += price; a.count++;
      } else {
        const date = dateByDoc[r.Ref_Key] || '';
        const a = agg[nk];
        if (!a || date >= a.date) agg[nk] = { date, price };
      }
    }
    if (rows.length < TOP) break;
    skip += TOP;
  }

  // 3) запись закупочной цены в товары (по сопоставленным номенклатурам)
  const stmts = [];
  let updated = 0, missing = 0, priced = 0;
  for (const nk in agg) {
    const a = agg[nk];
    const price = isAvg ? a.sum / a.count : a.price;
    if (!Number.isFinite(price) || price <= 0) continue;
    priced++;
    const pid = byRef[nk];
    if (!pid) { missing++; continue; }
    stmts.push(env.DB.prepare('UPDATE products SET price_cost=? WHERE id=?').bind(Math.round(price * 100) / 100, pid));
    updated++;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const info = `${isAvg ? 'средняя' : 'последняя'}: приходов ${docs}, строк ${lines}, с ценой ${priced}, обновлено ${updated}, не сопоставлено ${missing}`;
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('prices_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ mode: isAvg ? 'avg' : 'last', docs, lines, priced, updated, missing });
}

// --------------------------------------------------------------------------
// Инвентаризация склада
//   inventory        — документ пересчёта (draft/posted)
//   inventory_items  — строки: учётный (expected) и фактический (counted) остаток
// Таблицы создаются на лету (CREATE IF NOT EXISTS) — без отдельной миграции.
// --------------------------------------------------------------------------
async function ensureInventorySchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      no TEXT,
      date TEXT,
      warehouse_id TEXT,
      status TEXT DEFAULT 'draft',
      scope TEXT,
      responsible_id TEXT,
      responsible_name TEXT,
      note TEXT,
      posted_at TEXT,
      items_count INTEGER DEFAULT 0,
      surplus_qty REAL DEFAULT 0,
      shortage_qty REAL DEFAULT 0,
      surplus_value REAL DEFAULT 0,
      shortage_value REAL DEFAULT 0
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory_items (
      inventory_id TEXT,
      product_id TEXT,
      sku TEXT,
      name TEXT,
      expected REAL DEFAULT 0,
      counted REAL,
      price_cost REAL DEFAULT 0,
      PRIMARY KEY (inventory_id, product_id)
    )`),
  ]);
}

async function inventoryList(env) {
  const r = await env.DB.prepare(`SELECT * FROM inventory ORDER BY date DESC LIMIT 100`).all();
  return json(r.results);
}

// Создаёт документ и наполняет строки снимком учётных остатков (INSERT…SELECT — без round-trip).
async function inventoryCreate(env, request, auth) {
  const b = await request.json().catch(() => ({}));
  const scope = ['all', 'instock', 'category'].includes(b.scope) ? b.scope : 'instock';
  const category = b.category || null;
  if (scope === 'category' && !category) return err(400, 'Для режима «по категории» нужна категория');
  const wh = b.warehouse_id || 'w1';
  const id = genId();
  const no = 'ИНВ-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + id.slice(0, 4).toUpperCase();

  await env.DB.prepare(
    `INSERT INTO inventory (id,no,date,warehouse_id,status,scope,responsible_id,responsible_name,note)
     VALUES (?,?,datetime('now'),?,'draft',?,?,?,?)`
  ).bind(id, no, wh, scope, auth.sub, auth.name || '', String(b.note || '')).run();

  const stockSub = `LEFT JOIN (SELECT product_id, SUM(stock) AS stock FROM product_stock GROUP BY product_id) s ON s.product_id = p.id`;
  let where = '';
  if (scope === 'instock') where = 'WHERE COALESCE(s.stock,0) > 0';
  else if (scope === 'category') where = 'WHERE p.category_id = ?';

  const insSql =
    `INSERT INTO inventory_items (inventory_id, product_id, sku, name, expected, counted, price_cost)
     SELECT ?, p.id, p.sku, p.name, COALESCE(s.stock,0), NULL, COALESCE(p.price_cost,0)
       FROM products p ${stockSub} ${where}`;
  const insArgs = scope === 'category' ? [id, category] : [id];
  const res = await env.DB.prepare(insSql).bind(...insArgs).run();
  const cnt = (res.meta && res.meta.changes) || 0;
  await env.DB.prepare(`UPDATE inventory SET items_count=? WHERE id=?`).bind(cnt, id).run();
  return json({ id, no, items_count: cnt, scope });
}

async function inventoryGet(env, id) {
  const doc = await env.DB.prepare(`SELECT * FROM inventory WHERE id=?`).bind(id).first();
  if (!doc) return err(404, 'Инвентаризация не найдена');
  const items = await env.DB.prepare(
    `SELECT product_id, sku, name, expected, counted, price_cost FROM inventory_items WHERE inventory_id=? ORDER BY name`
  ).bind(id).all();
  doc.items = items.results;
  return json(doc);
}

// Массовое сохранение фактических количеств (counted). null = ещё не пересчитано.
async function inventorySaveItems(env, id, request) {
  const doc = await env.DB.prepare(`SELECT status FROM inventory WHERE id=?`).bind(id).first();
  if (!doc) return err(404, 'Инвентаризация не найдена');
  if (doc.status === 'posted') return err(409, 'Инвентаризация уже проведена');
  const b = await request.json().catch(() => ({}));
  const items = Array.isArray(b.items) ? b.items : [];
  const stmts = [];
  for (const it of items) {
    if (!it || !it.product_id) continue;
    const raw = it.counted;
    const c = (raw === null || raw === undefined || raw === '') ? null : Number(raw);
    if (c !== null && !Number.isFinite(c)) continue;
    stmts.push(env.DB.prepare(`UPDATE inventory_items SET counted=? WHERE inventory_id=? AND product_id=?`).bind(c, id, it.product_id));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return json({ ok: true, saved: stmts.length });
}

// Проведение: выставляет фактические остатки на склад и считает расхождения для актов.
async function inventoryPost(env, id) {
  const doc = await env.DB.prepare(`SELECT * FROM inventory WHERE id=?`).bind(id).first();
  if (!doc) return err(404, 'Инвентаризация не найдена');
  if (doc.status === 'posted') return err(409, 'Инвентаризация уже проведена');
  const wh = doc.warehouse_id || 'w1';
  const counted = await env.DB.prepare(
    `SELECT product_id, expected, counted, price_cost FROM inventory_items WHERE inventory_id=? AND counted IS NOT NULL`
  ).bind(id).all();

  const stmts = [];
  let surplusQty = 0, shortageQty = 0, surplusVal = 0, shortageVal = 0, adjusted = 0;
  for (const it of counted.results) {
    const diff = Number(it.counted) - Number(it.expected || 0);
    if (diff !== 0) {
      adjusted++;
      const val = Math.abs(diff) * Number(it.price_cost || 0);
      if (diff > 0) { surplusQty += diff; surplusVal += val; }
      else { shortageQty += -diff; shortageVal += val; }
    }
    // фактический остаток на склад (upsert — товар мог быть без строки остатка)
    stmts.push(env.DB.prepare(
      `INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?,?,?,0)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET stock=excluded.stock`
    ).bind(it.product_id, wh, Number(it.counted)));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  await env.DB.prepare(
    `UPDATE inventory SET status='posted', posted_at=datetime('now'),
       surplus_qty=?, shortage_qty=?, surplus_value=?, shortage_value=? WHERE id=?`
  ).bind(surplusQty, shortageQty, surplusVal, shortageVal, id).run();
  return json({ ok: true, counted: counted.results.length, adjusted, surplusQty, shortageQty, surplusValue: surplusVal, shortageValue: shortageVal });
}

// Иконка категории по названию (для категорий из 1С, у которых стоит заглушка 📁).
const CATEGORY_ICONS = [
  [/автомат|выключател|модульн/i, '⚡'],
  [/кабел|провод/i, '🔌'],
  [/кнопк/i, '🔘'],
  [/контактор|пускател|реле/i, '🧲'],
  [/наконечник|гильз|клемм|зажим/i, '🔩'],
  [/предохранител/i, '🛡'],
  [/щит|корпус|бокс|шкаф/i, '🗄'],
  [/освещ|лампа|светильник|прожектор|свет/i, '💡'],
  [/розетк|вилк|удлинител/i, '🔌'],
  [/трансформатор/i, '🔋'],
  [/счётчик|счетчик|прибор|учёт|учет|измер/i, '📟'],
  [/инструмент/i, '🛠'],
  [/нва/i, '⚙'],
  [/тэц/i, '🔥'],
  [/тдм/i, '🏭'],
  [/материал/i, '🧰'],
  [/гос.?закуп/i, '🏛'],
  [/готов/i, '✅'],
  [/услуг/i, '🧾'],
];
function categoryIcon(name, current) {
  if (current && current !== '📁') return current; // уважаем заданную вручную
  const s = String(name || '');
  for (const [re, ic] of CATEGORY_ICONS) if (re.test(s)) return ic;
  return '📦';
}

// Категории каталога с числом товаров (только непустые) — для плиток каталога.
// Корневую папку «Товары» не показываем как категорию: товары из неё попадают
// в общий список «Все товары». total — честное число всех товаров (для плитки «Все»).
async function catalogCategories(env) {
  const cats = await env.DB.prepare(
    `SELECT c.id, c.name, c.icon, COUNT(p.id) AS count
       FROM product_categories c JOIN products p ON p.category_id = c.id
      WHERE c.name <> 'Товары'
      GROUP BY c.id, c.name, c.icon HAVING count > 0 ORDER BY c.name`
  ).all();
  const list = cats.results.map((c) => ({ ...c, icon: categoryIcon(c.name, c.icon) }));
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first();
  return json({ total: total ? total.n : 0, categories: list });
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
