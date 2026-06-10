// ============================================================================
// KES CRM — единый REST API над D1/R2 (Cloudflare Pages Functions). Слой 2.
//
// Один catch-all обработчик на /api/* — чтобы не плодить десятки файлов-роутов.
// Бизнес-сущности обслуживаются обобщённым CRUD (таблица из белого списка +
// интроспекция колонок через PRAGMA), а каталог/сделки/клиенты/файлы — точечно.
//
// Безопасность SQL: имена таблиц берутся ТОЛЬКО из белого списка TABLES, все
// значения подставляются через .bind() (параметризованные запросы).
//
// Авторизация (JWT) появится в Слое 3 — сейчас эндпоинты открыты.
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
// Точка входа Pages Functions
// --------------------------------------------------------------------------
export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const seg = path ? path.split('/') : [];

  try {
    if (seg.length === 0) return json({ ok: true, name: 'KES CRM API', resources: Object.keys(TABLES) });
    if (seg[0] === 'files') return filesRoute(context, seg.slice(1));
    return dataRoute(context, seg, url);
  } catch (e) {
    return err(500, e && e.message ? e.message : String(e));
  }
}

// --------------------------------------------------------------------------
// Данные (D1)
// --------------------------------------------------------------------------
async function dataRoute({ request, env }, seg, url) {
  if (!env.DB) return err(500, 'D1 binding DB не настроен (см. wrangler.toml)');

  const resource = ALIASES[seg[0]] || seg[0];
  const meta = TABLES[resource];
  if (!meta) return err(404, `Неизвестный ресурс: ${seg[0]}`);
  const id = seg[1];
  const method = request.method;

  // --- точечная обработка ---
  if (resource === 'products' && method === 'GET' && !id) return listProducts(env, url);
  if (resource === 'deals' && method === 'GET' && id) return getDeal(env, id);
  if (resource === 'deals' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeDeal(env, request, method, id);
  if (resource === 'clients' && method === 'GET') return id ? getClient(env, id) : listClients(env, url);
  if (resource === 'clients' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeClient(env, request, method, id);

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

async function writeDeal(env, request, method, id) {
  const body = await request.json().catch(() => ({}));
  const dealId = id || body.id || genId();
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : null;

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
  return getDeal(env, dealId);
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
