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

    // синхронизация с 1С
    if (seg[0] === 'sync') {
      // авто-запуск по расписанию: токен внешнего планировщика ИЛИ любой авторизованный сотрудник
      if (seg[1] === 'run' && request.method === 'POST') {
        const token = url.searchParams.get('token');
        const ok = (token && env.CRON_SECRET && token === env.CRON_SECRET) || !!auth;
        if (!ok) return err(403, 'Нет доступа к авто-синхронизации');
        return json(await runDueSyncs(env));
      }
      if (!auth) return err(401, 'Требуется авторизация');
      if (auth.role !== 'director') return err(403, 'Только директор может запускать синхронизацию');
      if (seg[1] === 'status' && request.method === 'GET') return syncStatus(env);
      // этап 4: очередь отправки в 1С — сводка/лог (GET) и принудительный досыл (POST)
      if (seg[1] === 'queue' && request.method === 'GET') return onecQueueStatus(env);
      if (seg[1] === 'queue' && request.method === 'POST') return json(await processOnecQueue(env, 50, true));
      // переключатель этапа 3 (отгрузки → 1С): только директор (проверка выше)
      if (seg[1] === 'flags' && request.method === 'GET') {
        return json({ shipments: await isShipmentsPushEnabled(env), shipments_env_forced: onecShipmentsEnvForced(env) });
      }
      if (seg[1] === 'flags' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        if (!onecShipmentsEnvForced(env)) await setSetting(env, 'onec_shipments', b.shipments ? '1' : '0');
        return json({ shipments: await isShipmentsPushEnabled(env), shipments_env_forced: onecShipmentsEnvForced(env) });
      }
      if (seg[1] === '1c' && seg[2] === 'clients' && request.method === 'POST') return syncClients(env);
      if (seg[1] === '1c' && seg[2] === 'suppliers' && request.method === 'POST') return syncSuppliers(env);
      if (seg[1] === '1c' && seg[2] === 'categories' && request.method === 'POST') return syncCategories(env);
      if (seg[1] === '1c' && seg[2] === 'stock' && request.method === 'POST') return syncStock(env);
      if (seg[1] === '1c' && seg[2] === 'receipts' && request.method === 'POST') return syncReceipts(env);
      if (seg[1] === '1c' && seg[2] === 'prices' && request.method === 'POST') {
        const mode = new URL(request.url).searchParams.get('mode');
        return syncPrices(env, mode === 'avg' ? 'avg' : 'last');
      }
      if (seg[1] === '1c' && seg[2] === 'saleprices' && request.method === 'POST') return syncSalePrices(env);
      if (seg[1] === '1c' && seg[2] === 'units' && request.method === 'POST') return syncUnits(env);
      if (seg[1] === '1c' && seg[2] === 'invoice-payments' && request.method === 'POST') return syncInvoicePayments(env);
      if (seg[1] === '1c' && seg[2] === 'products' && request.method === 'POST') {
        const u = new URL(request.url);
        const lim = parseInt(u.searchParams.get('limit'), 10);
        const skp = parseInt(u.searchParams.get('skip'), 10);
        return syncProducts(env, Number.isFinite(lim) ? lim : 1000, Number.isFinite(skp) ? skp : 0);
      }
      return err(404, 'Неизвестная синхронизация: ' + seg.join('/'));
    }

    // Green API webhook (входящие сообщения) — ПУБЛИЧНЫЙ (Green API без JWT), защита токеном в URL
    if (seg[0] === 'greenapi' && seg[1] === 'webhook' && request.method === 'POST') {
      return greenapiWebhook(env, request, url);
    }
    // Binotel webhook входящих звонков — ПУБЛИЧНЫЙ (защита токеном в URL)
    if (seg[0] === 'binotel' && seg[1] === 'webhook' && request.method === 'POST') {
      return binotelWebhook(env, request, url);
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

    // удаление демо/захардкоженных данных (директор): сделки, клиенты, документы,
    // поставщики, товары, отгрузки. Записи, связанные с 1С (ext_ref), сохраняются.
    if (seg[0] === 'admin' && seg[1] === 'clear-demo' && request.method === 'POST') {
      if (auth.role !== 'director') return err(403, 'Только директор может удалять демо-данные');
      return clearDemoData(env);
    }

    // категории каталога с подсчётом товаров (для плиток)
    if (seg[0] === 'catalog' && seg[1] === 'categories' && request.method === 'GET') return catalogCategories(env);
    if (seg[0] === 'catalog' && seg[1] === 'price-coverage' && request.method === 'GET') {
      const r = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN COALESCE(price_cost,0)>0 THEN 1 ELSE 0 END) AS cost,
                SUM(CASE WHEN COALESCE(price_wholesale,0)>0 THEN 1 ELSE 0 END) AS wholesale,
                SUM(CASE WHEN COALESCE(price_retail,0)>0 THEN 1 ELSE 0 END) AS retail,
                SUM(CASE WHEN COALESCE(price_cost,0)>0 OR COALESCE(price_wholesale,0)>0 OR COALESCE(price_retail,0)>0 THEN 1 ELSE 0 END) AS any
           FROM products`
      ).first();
      return json(r || { total: 0, cost: 0, wholesale: 0, retail: 0, any: 0 });
    }

    // покрытие остатками 1С: сколько позиций с остатком + инфо/время последнего синка остатков
    if (seg[0] === 'catalog' && seg[1] === 'stock-coverage' && request.method === 'GET') {
      const r = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN COALESCE(s.stock,0)>0 THEN 1 ELSE 0 END) AS withStock,
                COALESCE(SUM(s.stock),0) AS units
           FROM products p
           LEFT JOIN (SELECT product_id, SUM(stock) AS stock FROM product_stock GROUP BY product_id) s
             ON s.product_id = p.id`
      ).first();
      const st = await env.DB.prepare("SELECT last_at, info FROM sync_state WHERE entity='stock_1c'").first();
      return json({ ...(r || { total: 0, withStock: 0, units: 0 }), lastAt: st && st.last_at, info: st && st.info });
    }

    // сводка по складу (для карточек: SKU, единиц, резерв, стоимость)
    if (seg[0] === 'warehouse' && seg[1] === 'summary' && request.method === 'GET') return warehouseSummary(env);

    // движения склада: приход/расход (корректируют остаток product_stock)
    if (seg[0] === 'stock-movements') {
      await ensureMovementsSchema(env);
      if (request.method === 'GET') return listMovements(env, url);
      if (request.method === 'POST') return createMovement(env, request, auth);
      return err(405, 'Метод не поддерживается');
    }
    // документы склада: приход/расход со статусами draft → posted → cancelled
    if (seg[0] === 'stock-docs') {
      await ensureMovementsSchema(env);
      const did = seg[1];
      if (request.method === 'POST' && did && seg[2] === 'post') return postStockDoc(env, did, auth);
      if (request.method === 'POST' && did && seg[2] === 'cancel') return cancelStockDoc(env, did, auth);
      if (request.method === 'GET') return did ? getStockDoc(env, did) : listStockDocs(env, url);
      if (request.method === 'POST' && !did) return createStockDoc(env, request, auth);
      if (['PUT', 'PATCH'].includes(request.method) && did) return updateStockDoc(env, request, did);
      if (request.method === 'DELETE' && did) return deleteStockDoc(env, did);
      return err(405, 'Метод не поддерживается');
    }

    // резерв товаров под сделку
    if (seg[0] === 'deals' && seg[1] && seg[2] === 'reserve' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      return reserveDeal(env, seg[1], !!b.release);
    }
    // какие сделки держат резерв по товару (проваливание со склада)
    if (seg[0] === 'products' && seg[1] && seg[2] === 'reservations' && request.method === 'GET') {
      return getProductReservations(env, seg[1]);
    }

    // агрегаты для раздела «Отчёты» (всё из данных CRM)
    if (seg[0] === 'reports' && seg[1] === 'summary' && request.method === 'GET') return reportsSummary(env, url);

    // архив: удалённые сделки/клиенты (мягкое удаление, авто-очистка через 30 дней)
    if (seg[0] === 'archive') {
      await ensureArchiveRight(env);
      if (!(await roleHasModule(env, auth, 'archive'))) return err(403, 'Нет права доступа «Архив»');
      await ensureArchiveColumns(env);
      await purgeExpiredArchive(env);
      if (seg[1] === 'restore' && request.method === 'POST') return restoreArchive(env, request);
      if (request.method === 'GET' && !seg[1]) return listArchive(env);
      return err(404, 'Неизвестный метод архива');
    }

    // интеграция WhatsApp через Green API (сообщения по сделке/клиенту)
    if (seg[0] === 'greenapi') {
      if (seg[1] === 'status' && request.method === 'GET') return greenapiStatus(env);
      if (seg[1] === 'send' && request.method === 'POST') return greenapiSend(env, request, auth);
      if (seg[1] === 'sendfile' && request.method === 'POST') return greenapiSendFile(env, request, auth);
      if (seg[1] === 'messages' && request.method === 'GET') return greenapiMessages(env, url);
      // настройки/проверка подключения — только директор
      if (seg[1] === 'settings' && request.method === 'GET') return auth.role === 'director' ? greenapiSettingsGet(env, url) : err(403, 'Только директор');
      if (seg[1] === 'settings' && request.method === 'POST') return auth.role === 'director' ? greenapiSettingsSave(env, request, url) : err(403, 'Только директор');
      if (seg[1] === 'check' && request.method === 'POST') return auth.role === 'director' ? greenapiCheck(env) : err(403, 'Только директор');
      return err(404, 'Неизвестный метод Green API');
    }

    // Ценообразование: формулы опт/розницы (настройки)
    if (seg[0] === 'pricing' && seg[1] === 'settings') {
      if (request.method === 'GET') return pricingSettingsGet(env);
      if (request.method === 'POST') return auth.role === 'director' ? pricingSettingsSave(env, request) : err(403, 'Только директор');
    }
    // Автоматизация: создавать отгрузку при полной оплате сделки
    if (seg[0] === 'automation' && seg[1] === 'settings') {
      if (request.method === 'GET') {
        await ensureAppSettings(env);
        return json({
          autoShipmentOnPaid: (await getSetting(env, 'auto_shipment_on_paid')) !== '0',
          reserveTermDays: parseInt(await getSetting(env, 'reserve_term_days'), 10) || 3,
        });
      }
      if (request.method === 'POST') {
        if (auth.role !== 'director') return err(403, 'Только директор');
        const b = await request.json().catch(() => ({}));
        if (b.autoShipmentOnPaid != null) await setSetting(env, 'auto_shipment_on_paid', b.autoShipmentOnPaid ? '1' : '0');
        if (b.reserveTermDays != null) await setSetting(env, 'reserve_term_days', String(Math.max(1, parseInt(b.reserveTermDays, 10) || 3)));
        return json({ autoShipmentOnPaid: (await getSetting(env, 'auto_shipment_on_paid')) !== '0', reserveTermDays: parseInt(await getSetting(env, 'reserve_term_days'), 10) || 3 });
      }
    }
    // Отчёты: цель (план продаж на месяц) — единая сумма, сохраняется в настройках
    if (seg[0] === 'reports' && seg[1] === 'goal') {
      await ensureAppSettings(env);
      if (request.method === 'GET') return json({
        goal: Number(await getSetting(env, 'monthly_goal')) || 0,
        from: (await getSetting(env, 'goal_from')) || '',
        to: (await getSetting(env, 'goal_to')) || '',
      });
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const v = Math.max(0, Math.round(Number(b.goal) || 0));
        await setSetting(env, 'monthly_goal', String(v));
        if (b.from != null) await setSetting(env, 'goal_from', String(b.from || '').slice(0, 10));
        if (b.to != null) await setSetting(env, 'goal_to', String(b.to || '').slice(0, 10));
        return json({ goal: v, from: String(b.from || '').slice(0, 10), to: String(b.to || '').slice(0, 10) });
      }
    }
    // Binotel (IP-телефония): click-to-call + настройки
    if (seg[0] === 'binotel') {
      if (seg[1] === 'call' && request.method === 'POST') return binotelCall(env, request, auth);
      if (seg[1] === 'settings' && request.method === 'GET') return auth.role === 'director' ? binotelSettingsGet(env, url) : err(403, 'Только директор');
      if (seg[1] === 'settings' && request.method === 'POST') return auth.role === 'director' ? binotelSettingsSave(env, request, url) : err(403, 'Только директор');
      return err(404, 'Неизвестный метод Binotel');
    }

    // WebRTC SIP-софтфон («звонки прямо из браузера»): креды для SIP.js + лог звонка.
    // Аудио идёт напрямую браузер ↔ Asterisk ↔ Binotel-trunk; бэкенд только выдаёт креды и логирует.
    if (seg[0] === 'sip') {
      if (seg[1] === 'token' && request.method === 'GET') return sipToken(env, auth);
      if (seg[1] === 'log' && request.method === 'POST') return sipLog(env, request, auth);
      return err(404, 'Неизвестный метод SIP');
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
async function dataRoute(ctx, seg, url, auth) {
  const { request, env } = ctx;
  if (!env.DB) return err(500, 'D1 binding DB не настроен (см. wrangler.toml)');

  const resource = ALIASES[seg[0]] || seg[0];
  const meta = TABLES[resource];
  if (!meta) return err(404, `Неизвестный ресурс: ${seg[0]}`);
  const id = seg[1];
  const method = request.method;

  // задачи: расширенные поля (описание/дата начала/статус/комментарии) — добавляем на лету
  if (resource === 'tasks') await ensureTaskColumns(env);
  if (resource === 'deals' || resource === 'clients' || resource === 'invoices') await ensureArchiveColumns(env);
  if (resource === 'shipments') await ensureShipmentsCleared(env); // одноразовая очистка всех отгрузок
  if (resource === 'shipments' && ['POST', 'PUT', 'PATCH'].includes(method)) await ensureShipmentStatuses(env);
  if (resource === 'suppliers') await ensureSupplierExtRef(env); // колонки ext_ref/bin
  if (resource === 'roles') { await ensureArchiveRight(env); await ensureDriverRole(env); } // право «Архив» директору + роль «Водитель»
  if (resource === 'deals') await ensureDealColumns(env);
  if (resource === 'company') await ensureCompanyColumns(env);
  if (['pipelines', 'deal_stages', 'deals'].includes(resource)) await ensurePipelineSchema(env);
  if (resource === 'deal_stages') await ensureReserveStage(env); // неудаляемая стадия «Резерв»

  // изменять роли (матрицу доступа) может только директор
  if (resource === 'roles' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!auth || auth.role !== 'director') return err(403, 'Менять доступы по ролям может только директор');
    if (method === 'DELETE' && id) return deleteRole(env, id, auth);
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
  if (resource === 'deals' && method === 'GET' && !id) return listDeals(env, url);
  if (resource === 'deals' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeDeal(env, request, method, id, auth);
  if (resource === 'deals' && method === 'DELETE' && id) return deleteDeal(env, id, auth);
  if (resource === 'clients' && id === 'distribute' && method === 'POST') {
    if (!auth || auth.role !== 'director') return err(403, 'Распределять базу может только директор');
    return distributeClients(env, request);
  }
  if (resource === 'clients' && method === 'GET') return id ? getClient(env, id) : listClients(env, url);
  if (resource === 'clients' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeClient(env, request, method, id, ctx);
  if (resource === 'clients' && method === 'DELETE' && id) return deleteClient(env, id, auth);
  if (resource === 'invoices' && method === 'GET' && !id) return listInvoices(env, url);
  if (resource === 'invoices' && method === 'DELETE' && id) return deleteInvoice(env, id, auth);
  if (resource === 'invoices' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeInvoice(env, request, method, id, ctx);
  if (resource === 'shipments' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeShipment(env, request, method, id, ctx);
  if (resource === 'suppliers' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeSupplier(env, request, method, id, ctx);
  if (resource === 'leads' && ['POST', 'PUT', 'PATCH'].includes(method)) return writeLead(env, request, method, id);
  if (resource === 'notifications' && id === 'scan-overdue' && method === 'POST') return scanOverdueTasks(env);
  if (resource === 'notifications' && id === 'read' && method === 'POST') return markNotificationsRead(env, auth);
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
  // фронт держит списки в памяти и пагинирует сам — отдаём с запасом (раньше лимит 500 терял часть)
  const limit = clampInt(url.searchParams.get('limit'), 5000, 1, 100000);
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
    // reserved не передан — сохраняем текущее значение (массовое изменение остатка)
    let reserved;
    if (b.reserved != null) reserved = num(b.reserved);
    else {
      const cur = await env.DB.prepare('SELECT reserved FROM product_stock WHERE product_id=? AND warehouse_id=?').bind(productId, warehouseId).first();
      reserved = cur ? num(cur.reserved) : 0;
    }
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
  const sort = (url.searchParams.get('sort') || '').trim();
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 1000);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 1e9);
  const offset = (page - 1) * limit;
  // числовой параметр диапазона (null, если не задан)
  const numP = (k) => { const v = url.searchParams.get(k); if (v == null || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; };
  const stockMin = numP('stock_min'), stockMax = numP('stock_max');
  const costMin = numP('cost_min'), costMax = numP('cost_max');

  const stockJoin =
    `LEFT JOIN (SELECT product_id, SUM(stock) AS stock, SUM(reserved) AS reserved
                  FROM product_stock GROUP BY product_id) s ON s.product_id = p.id`;

  const where = [];
  const args = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (cat) { where.push('p.category_id = ?'); args.push(cat); }
  if (brand) { where.push('p.brand = ?'); args.push(brand); }
  if (low != null) { where.push('(COALESCE(s.stock,0) - COALESCE(s.reserved,0)) < ?'); args.push(low); }
  if (stockMin != null) { where.push('COALESCE(s.stock,0) >= ?'); args.push(stockMin); }
  if (stockMax != null) { where.push('COALESCE(s.stock,0) <= ?'); args.push(stockMax); }
  if (costMin != null) { where.push('COALESCE(p.price_cost,0) >= ?'); args.push(costMin); }
  if (costMax != null) { where.push('COALESCE(p.price_cost,0) <= ?'); args.push(costMax); }
  const ws = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const needStockJoin = low != null || stockMin != null || stockMax != null;

  // join в COUNT нужен только когда фильтруем по остатку
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p ${needStockJoin ? stockJoin : ''} ${ws}`
  ).bind(...args).first();

  let order = low != null ? '(COALESCE(s.stock,0) - COALESCE(s.reserved,0)) ASC' : 'p.name';
  if (sort === 'price_asc') order = 'p.price_wholesale ASC, p.name';
  else if (sort === 'price_desc') order = 'p.price_wholesale DESC, p.name';
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
    'ALTER TABLE deals ADD COLUMN delivery_date TEXT',
    'ALTER TABLE deals ADD COLUMN delivery_transport TEXT',
    'ALTER TABLE deals ADD COLUMN delivery_driver TEXT',
    'ALTER TABLE deals ADD COLUMN phone TEXT',
    'ALTER TABLE deals ADD COLUMN reserved_at TEXT',
  ]) { try { await env.DB.prepare(ddl).run(); } catch (e) { /* уже есть */ } }
  DEALS_SCHEMA_OK = true;
}

// Роль «Водитель» (этап 4): заходит по отгрузке, отмечает «Доставлено» с фото.
let DRIVER_ROLE_OK = false;
async function ensureDriverRole(env) {
  if (DRIVER_ROLE_OK) return;
  try {
    await env.DB.prepare('INSERT OR IGNORE INTO roles (key,label,color,modules,can_edit,see_all_data) VALUES (?,?,?,?,?,?)')
      .bind('driver', 'Водитель', '#0EA5E9', JSON.stringify(['dashboard', 'shipments']), JSON.stringify({ delivery: true }), 1).run();
  } catch (e) {}
  DRIVER_ROLE_OK = true;
}

// Удаление роли: пользователей этой роли переносим на запасную роль (чтобы не нарушить FK).
async function deleteRole(env, key, auth) {
  if (auth && auth.role === key) return err(400, 'Нельзя удалить свою текущую роль');
  const cnt = (await env.DB.prepare('SELECT COUNT(*) AS n FROM roles').first()).n;
  if (cnt <= 1) return err(400, 'Нельзя удалить последнюю роль');
  const fallback = await env.DB.prepare('SELECT key FROM roles WHERE key<>? ORDER BY key LIMIT 1').bind(key).first();
  if (!fallback) return err(400, 'Нет запасной роли для переноса пользователей');
  await env.DB.prepare('UPDATE users SET role_key=? WHERE role_key=?').bind(fallback.key, key).run();
  await env.DB.prepare('DELETE FROM roles WHERE key=?').bind(key).run();
  return json({ deleted: 1, reassignedTo: fallback.key });
}

// Реквизиты компании: расширенные поля (редактируются в настройках). Добавляются на лету.
let COMPANY_SCHEMA_OK = false;
async function ensureCompanyColumns(env) {
  if (COMPANY_SCHEMA_OK) return;
  for (const ddl of [
    'ALTER TABLE company ADD COLUMN legal_name TEXT',
    'ALTER TABLE company ADD COLUMN bin TEXT',
    'ALTER TABLE company ADD COLUMN address TEXT',
    'ALTER TABLE company ADD COLUMN work_hours TEXT',
    'ALTER TABLE company ADD COLUMN website TEXT',
    'ALTER TABLE company ADD COLUMN note TEXT',
    'ALTER TABLE company ADD COLUMN phone TEXT',
    'ALTER TABLE company ADD COLUMN bank_account TEXT',
    'ALTER TABLE company ADD COLUMN bank_bik TEXT',
    'ALTER TABLE company ADD COLUMN bank_name TEXT',
  ]) { try { await env.DB.prepare(ddl).run(); } catch (e) { /* уже есть */ } }
  // значения по умолчанию (если пусто) — чтобы карточка не была пустой
  try {
    await env.DB.prepare(
      `UPDATE company SET
         legal_name = COALESCE(legal_name, 'ТОО «KazEnergoSnab»'),
         bin        = COALESCE(bin, '180440099887'),
         address    = COALESCE(address, 'Караганда, ул. Бытовая, 13/1'),
         work_hours = COALESCE(work_hours, 'Пн–Пт 9:00–18:00, обед 13:00–14:00'),
         website    = COALESCE(website, 'snabenergo.kz'),
         note       = COALESCE(note, 'Сертифицированный субдилер по РК с 2018')
       WHERE id = 1`
    ).run();
  } catch (e) {}
  COMPANY_SCHEMA_OK = true;
}

// Реквизиты организации из 1С (Catalog_Организации + контактная информация + банковский счёт).
// Имена реквизитов в КЗ-конфигурациях отличаются, поэтому берём ВСЕ поля (без $select) и
// пробуем несколько вариантов. Обновляем только непустыми значениями (existing не затираем пустым).
async function syncCompany1C(env) {
  if (!env.ODATA_URL) return;
  await ensureCompanyColumns(env);
  let org = null;
  try {
    const data = await odataGet(env, 'Catalog_Организации?$format=json&$top=50');
    const rows = (data.value || []).filter((r) => !r.DeletionMark);
    const want = ONEC_ORG_NAME.toLowerCase();
    org = rows.find((r) => String(r['НаименованиеПолное'] || r.Description || '').toLowerCase().includes(want)) || rows[0];
  } catch (e) { return; }
  if (!org) return;
  const pick = (...keys) => { for (const k of keys) { const v = org[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return null; };
  const name = pick('НаименованиеПолное', 'Description');
  const bin = pick('БИН', 'ИИН', 'ИдентификационныйКодЛичности', 'ИНН', 'РегистрационныйНомер');

  // контактная информация (адрес/телефон) — подчинённая таблица, фильтруем по владельцу
  let address = null, phone = null;
  try {
    const ci = await odataGet(env, 'Catalog_Организации_КонтактнаяИнформация?$format=json&$top=300');
    for (const r of (ci.value || [])) {
      if (r.Ref_Key !== org.Ref_Key) continue;
      const t = String(r['Тип'] || '').toLowerCase(); const rep = String(r['Представление'] || '').trim();
      if (!rep) continue;
      if (!address && /адрес/.test(t)) address = rep;
      if (!phone && /телефон/.test(t)) phone = rep;
    }
  } catch (e) {}

  // банковский счёт организации (+ БИК/название банка)
  let acc = null, bik = null, bankName = null;
  try {
    const bs = await odataGet(env, 'Catalog_БанковскиеСчета?$format=json&$top=300');
    const rows = (bs.value || []).filter((r) => !r.DeletionMark && (r.Owner_Key === org.Ref_Key || r.Owner === org.Ref_Key));
    const main = rows.find((r) => r.Ref_Key === org['ОсновнойБанковскийСчет_Key']) || rows[0];
    if (main) {
      acc = (main['НомерСчета'] && String(main['НомерСчета']).trim()) || null;
      const bankRef = main['Банк_Key'] || main['БанкДляРасчетов_Key'];
      if (bankRef && bankRef !== '00000000-0000-0000-0000-000000000000') {
        try {
          const bank = await odataGet(env, `Catalog_Банки(guid'${bankRef}')?$format=json`);
          bik = (bank.Code && String(bank.Code).trim()) || null;
          bankName = (bank.Description && String(bank.Description).trim()) || null;
        } catch (e) {}
      }
    }
  } catch (e) {}

  await env.DB.prepare(
    `UPDATE company SET
       legal_name   = COALESCE(?, legal_name),
       bin          = COALESCE(?, bin),
       address      = COALESCE(?, address),
       phone        = COALESCE(?, phone),
       bank_account = COALESCE(?, bank_account),
       bank_bik     = COALESCE(?, bank_bik),
       bank_name    = COALESCE(?, bank_name)
     WHERE id = 1`
  ).bind(name, bin, address, phone, acc, bik, bankName).run();
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('company_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(`орг: ${name || '—'}, БИН ${bin || '—'}, счёт ${acc ? 'есть' : 'нет'}`).run();
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
  await ensureClosedStageRemoved(env); // убираем этап «Закрыта» из воронок (по запросу)
  PIPELINES_SCHEMA_OK = true;
}

// Удаление этапа «Закрыта» из всех воронок: сделки переносятся на «Отгружено»
// (иначе «Оплачено», иначе последний по порядку), затем этап удаляется. Идемпотентно.
async function ensureClosedStageRemoved(env) {
  try {
    const rows = await env.DB.prepare("SELECT id, pipeline_id FROM deal_stages WHERE id='closed' OR label LIKE 'Закры%'").all();
    for (const r of (rows.results || [])) {
      const pid = r.pipeline_id || 'default';
      const fb = await env.DB.prepare(
        "SELECT id FROM deal_stages WHERE id<>? AND pipeline_id=? ORDER BY (label LIKE 'Отгруж%') DESC, (label LIKE 'Оплач%') DESC, sort DESC LIMIT 1"
      ).bind(r.id, pid).first();
      if (!fb) continue; // единственный этап — не трогаем
      await env.DB.prepare('UPDATE deals SET stage_id=? WHERE stage_id=?').bind(fb.id, r.id).run();
      await env.DB.prepare('DELETE FROM deal_stages WHERE id=?').bind(r.id).run();
    }
  } catch (e) {}
}

// Неудаляемая стадия «Резерв» в каждой воронке (бронь без оплаты). Создаём один раз, если её нет.
let RESERVE_STAGE_OK = false;
async function ensureReserveStage(env) {
  if (RESERVE_STAGE_OK) return;
  try {
    const pipes = await env.DB.prepare('SELECT DISTINCT pipeline_id AS id FROM deal_stages').all();
    const list = (pipes.results && pipes.results.length) ? pipes.results : [{ id: 'default' }];
    for (const p of list) {
      const pid = p.id || 'default';
      const ex = await env.DB.prepare("SELECT id FROM deal_stages WHERE pipeline_id=? AND lower(label) LIKE '%резерв%'").bind(pid).first();
      if (ex) continue;
      // ставим после «Согласовано/Счёт» (среди рабочих этапов, до Оплачено)
      const ref = await env.DB.prepare("SELECT sort FROM deal_stages WHERE pipeline_id=? AND (lower(label) LIKE '%согласов%' OR lower(label) LIKE '%счёт%' OR lower(label) LIKE '%счет%') ORDER BY sort LIMIT 1").bind(pid).first();
      const sort = ref && ref.sort != null ? ref.sort : 3;
      await env.DB.prepare('INSERT INTO deal_stages (id, label, color, sort, pipeline_id, protected) VALUES (?,?,?,?,?,1)')
        .bind(genId(), 'Резерв', '#F59E0B', sort, pid).run();
    }
  } catch (e) {}
  RESERVE_STAGE_OK = true;
}
async function isReserveStage(env, stageId) {
  if (!stageId) return false;
  const r = await env.DB.prepare("SELECT 1 AS y FROM deal_stages WHERE id=? AND lower(label) LIKE '%резерв%'").bind(stageId).first();
  return !!(r && r.y);
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
    ['Отказ', '#EF4444', 1],
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

// Истёкший резерв: сделки на стадии «Резерв», у которых reserved_at + срок < сейчас →
// уведомление менеджеру и директорам (идемпотентно, без авто-снятия). Срок — из настроек.
async function scanReserveExpiry(env) {
  await ensureNotifSchema(env);
  await ensureReserveStage(env);
  await ensureDealColumns(env);
  const termDays = parseInt(await getSetting(env, 'reserve_term_days'), 10) || 3;
  const rows = await env.DB.prepare(
    `SELECT d.id, d.no, d.title, d.manager_id
       FROM deals d JOIN deal_stages s ON s.id = d.stage_id
      WHERE lower(s.label) LIKE '%резерв%' AND d.reserved_at IS NOT NULL AND d.reserved_at<>''
        AND (d.archived_at IS NULL OR d.archived_at='')
        AND (julianday('now') - julianday(d.reserved_at)) >= ?`
  ).bind(termDays).all();
  const dirs = await env.DB.prepare("SELECT id FROM users WHERE role_key='director' AND active=1").all();
  const dirIds = (dirs.results || []).map((d) => d.id);
  const stmts = [];
  for (const r of (rows.results || [])) {
    const recips = new Set(dirIds); if (r.manager_id) recips.add(r.manager_id);
    const txt = `Истёк срок резерва (${termDays} дн.): сделка ${r.no || ''} «${r.title || ''}». Снять с резерва?`;
    for (const uid of recips) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (text, type, read, created_at, user_id, ref) VALUES (?, 'warn', 0, datetime('now'), ?, ?)").bind(txt, uid, `reserveexp:${r.id}:${uid}`));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return json({ expired: (rows.results || []).length });
}

async function listNotifications(env, auth) {
  await ensureNotifSchema(env);
  const uid = auth ? auth.sub : null;
  // только НЕпрочитанные — после «Прочитать все» (read=1) они не возвращаются и не всплывают снова
  const r = await env.DB.prepare(
    'SELECT * FROM notifications WHERE (user_id IS NULL OR user_id = ?) AND (read IS NULL OR read = 0) ORDER BY created_at DESC LIMIT 100'
  ).bind(uid).all();
  return json(r.results);
}
// Пометить уведомления пользователя прочитанными (сохраняется в БД).
async function markNotificationsRead(env, auth) {
  await ensureNotifSchema(env);
  const uid = auth ? auth.sub : null;
  // Помечаем прочитанными и адресные (user_id = текущий), и общие (user_id IS NULL) —
  // иначе общие/легаси-уведомления (созданные до появления колонки user_id) listNotifications
  // возвращал бы снова после перезагрузки, и они «приходили» бы повторно.
  if (uid) await env.DB.prepare('UPDATE notifications SET read=1 WHERE user_id=? OR user_id IS NULL').bind(uid).run();
  else await env.DB.prepare('UPDATE notifications SET read=1 WHERE user_id IS NULL').run();
  return json({ ok: true });
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
  try { await env.DB.prepare('ALTER TABLE messages ADD COLUMN file_url TEXT').run(); } catch (e) {} // вложения (фото/файлы)
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
  const { inst, tok } = await greenCreds(env);
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
      'SELECT c.id AS cid, COALESCE(NULLIF(c.phone,\'\'), dd.phone) AS phone FROM deals dd LEFT JOIN clients c ON c.id = dd.client_id WHERE dd.id=?'
    ).bind(dealId).first();
    if (d) { phone = phone || d.phone; clientId = clientId || d.cid; }
  }
  if (!phone && clientId) {
    const c = await env.DB.prepare('SELECT phone FROM clients WHERE id=?').bind(clientId).first();
    phone = c && c.phone;
  }

  const chatId = toChatId(phone);
  if (!chatId) return err(400, 'У клиента не указан корректный номер телефона');

  const { inst, tok, base } = await greenCreds(env);
  if (!inst || !tok) {
    return err(503, 'Green API не настроен: задайте Instance ID и API Token в настройках (или секреты GREENAPI_*)');
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

// Отправка файла/фото в WhatsApp через Green API (sendFileByUrl). Файл предварительно
// загружается в R2 (его URL публично доступен по GET), этот URL и шлём в Green API.
async function greenapiSendFile(env, request, auth) {
  await ensureMessagesSchema(env);
  const b = await request.json().catch(() => ({}));
  let url = String(b.url || '').trim();
  if (!url) return err(400, 'Не передан файл');
  // Green API скачивает файл по URL со своих серверов — нужен АБСОЛЮТНЫЙ адрес
  if (url.startsWith('/')) { try { url = new URL(url, request.url).href; } catch (e) {} }
  const fileName = String(b.fileName || 'file').slice(0, 120);
  const caption = String(b.caption || '').trim();

  let phone = b.phone || null, clientId = b.clientId || null;
  const dealId = b.dealId || null;
  if ((!phone || !clientId) && dealId) {
    const d = await env.DB.prepare('SELECT c.id AS cid, COALESCE(NULLIF(c.phone,\'\'), dd.phone) AS phone FROM deals dd LEFT JOIN clients c ON c.id = dd.client_id WHERE dd.id=?').bind(dealId).first();
    if (d) { phone = phone || d.phone; clientId = clientId || d.cid; }
  }
  if (!phone && clientId) { const c = await env.DB.prepare('SELECT phone FROM clients WHERE id=?').bind(clientId).first(); phone = c && c.phone; }
  const chatId = toChatId(phone);
  if (!chatId) return err(400, 'У клиента не указан корректный номер телефона');

  const { inst, tok, base } = await greenCreds(env);
  if (!inst || !tok) return err(503, 'Green API не настроен: задайте Instance ID и API Token');

  let status = 'sent', extId = null, errMsg = null;
  try {
    const res = await fetch(`${base}/waInstance${inst}/sendFileByUrl/${tok}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, urlFile: url, fileName, caption }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { status = 'error'; errMsg = 'Green API ' + res.status + (data && data.message ? ': ' + data.message : ''); }
    else extId = (data && data.idMessage) || null;
  } catch (e) { status = 'error'; errMsg = String((e && e.message) || e); }

  const id = genId();
  await env.DB.prepare(
    `INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, file_url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).bind(id, dealId, clientId, String(phone), 'out', 'whatsapp', caption || fileName, status, extId, auth && auth.sub, url).run();

  if (status === 'error') return err(502, errMsg || 'Не удалось отправить файл');
  return json({ ok: true, id, idMessage: extId });
}

// Креды Green API: приоритет — настройки из CRM (app_settings), затем секреты окружения.
async function greenCreds(env) {
  await ensureAppSettings(env);
  const inst = (await getSetting(env, 'greenapi_instance')) || env.GREENAPI_INSTANCE || '';
  const tok = (await getSetting(env, 'greenapi_token')) || env.GREENAPI_TOKEN || '';
  const base = (env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/+$/, '');
  return { inst, tok, base };
}

// Настройки Green API + автораспределения (для раздела настроек). webhook-токен генерируем при первом чтении.
async function greenapiSettingsGet(env, url) {
  await ensureAppSettings(env);
  let wt = await getSetting(env, 'greenapi_webhook_token');
  if (!wt) { wt = genId(); await setSetting(env, 'greenapi_webhook_token', wt); }
  const { inst, tok } = await greenCreds(env);
  const autod = await getSetting(env, 'autodistribute');
  let excluded = []; try { excluded = JSON.parse((await getSetting(env, 'autodistribute_excluded')) || '[]'); } catch (e) {}
  const origin = url ? url.origin : '';
  return json({
    instance: inst, token: tok, configured: !!(inst && tok),
    autodistribute: autod !== '0', // по умолчанию включено
    excluded,
    webhookUrl: origin + '/api/greenapi/webhook?token=' + wt,
  });
}
async function greenapiSettingsSave(env, request, url) {
  await ensureAppSettings(env);
  const b = await request.json().catch(() => ({}));
  if (b.instance != null) await setSetting(env, 'greenapi_instance', String(b.instance).trim());
  if (b.token != null) await setSetting(env, 'greenapi_token', String(b.token).trim());
  if (b.autodistribute != null) await setSetting(env, 'autodistribute', b.autodistribute ? '1' : '0');
  if (Array.isArray(b.excluded)) await setSetting(env, 'autodistribute_excluded', JSON.stringify(b.excluded));
  return greenapiSettingsGet(env, url);
}
// «Проверить подключение» — getStateInstance Green API.
async function greenapiCheck(env) {
  const { inst, tok, base } = await greenCreds(env);
  if (!inst || !tok) return json({ ok: false, state: 'no-creds', message: 'Instance ID и API Token не заданы' });
  try {
    const res = await fetch(`${base}/waInstance${inst}/getStateInstance/${tok}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ ok: false, state: 'error', message: 'Green API ' + res.status + (data && data.message ? ': ' + data.message : '') });
    const st = data && data.stateInstance;
    return json({ ok: st === 'authorized', state: st || 'unknown' });
  } catch (e) { return json({ ok: false, state: 'error', message: String((e && e.message) || e) }); }
}

// ---- Binotel (этап 7): IP-телефония — click-to-call + webhook входящих звонков ----
const BINOTEL_API = 'https://api.binotel.com/api/4.0';
async function binotelCreds(env) {
  return {
    key: (await getSetting(env, 'binotel_key')) || '',
    secret: (await getSetting(env, 'binotel_secret')) || '',
    ext: (await getSetting(env, 'binotel_ext')) || '',
  };
}
async function binotelSettingsGet(env, url) {
  await ensureAppSettings(env);
  let wt = await getSetting(env, 'binotel_webhook_token');
  if (!wt) { wt = genId(); await setSetting(env, 'binotel_webhook_token', wt); }
  const { key, secret, ext } = await binotelCreds(env);
  const origin = url ? url.origin : '';
  return json({ key, secret, ext, configured: !!(key && secret), webhookUrl: origin + '/api/binotel/webhook?token=' + wt });
}
async function binotelSettingsSave(env, request, url) {
  await ensureAppSettings(env);
  const b = await request.json().catch(() => ({}));
  if (b.key != null) await setSetting(env, 'binotel_key', String(b.key).trim());
  if (b.secret != null) await setSetting(env, 'binotel_secret', String(b.secret).trim());
  if (b.ext != null) await setSetting(env, 'binotel_ext', String(b.ext).trim());
  return binotelSettingsGet(env, url);
}

// ── WebRTC SIP-софтфон ────────────────────────────────────────────────────
// GET /api/sip/token — выдаёт креды браузеру (SIP.js). Без секретов SIP_DOMAIN/
// SIP_ENDPOINT_PASSWORD → 503 sip_not_configured (фронт тихо прячет UI).
function sipToken(env, auth) {
  const domain = env.SIP_DOMAIN, password = env.SIP_ENDPOINT_PASSWORD;
  if (!domain || !password) return err(503, 'sip_not_configured');
  const sipUser = env.SIP_USER || '100';
  const iceServers = [
    { urls: `stun:${domain}:3478` },
    { urls: 'stun:stun.l.google.com:19302' },
  ];
  if (env.SIP_TURN_URL && env.SIP_TURN_USERNAME && env.SIP_TURN_PASSWORD) {
    iceServers.push({
      urls: [env.SIP_TURN_URL, env.SIP_TURN_URL + '?transport=tcp'],
      username: env.SIP_TURN_USERNAME, credential: env.SIP_TURN_PASSWORD,
    });
  }
  return json({
    user: sipUser, password, domain,
    wss: `wss://${domain}:8089/ws`,
    iceServers,
    display_name: (auth && (auth.name || auth.sub)) || '',
  });
}

// POST /api/sip/log — пишем звонок в историю (таблица messages, channel='call'):
// направление, длительность, привязка к сделке/клиенту (клиент ищется по номеру).
async function sipLog(env, request, auth) {
  await ensureMessagesSchema(env);
  const b = await request.json().catch(() => ({}));
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  if (!phone || phone.length < 7) return json({ ok: false, error: 'invalid_phone' });
  const incoming = !!(b.incoming || b.direction === 'in');
  const dur = Math.max(0, Math.round(Number(b.duration_sec != null ? b.duration_sec : b.durationSec) || 0));
  const dealId = b.deal_id || b.dealId || null;
  let clientId = b.customer_id || b.customerId || null;
  if (!clientId) {
    try {
      const tail = phone.slice(-9);
      const c = await env.DB.prepare("SELECT id FROM clients WHERE phone IS NOT NULL AND phone<>'' AND REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'+',''),'-',''),'(','') LIKE ? LIMIT 1").bind('%' + tail).first();
      if (c) clientId = c.id;
    } catch (e) {}
  }
  const mm = dur > 0 ? (Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0')) : '—';
  const who = b.contact_name || b.contactName || '';
  const text = `${incoming ? '📞 Входящий звонок' : '📞 Исходящий звонок'} · ${mm}${who ? ' · ' + who : ''}`;
  const id = genId();
  await env.DB.prepare(
    "INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind(id, dealId, clientId, '+' + phone, incoming ? 'in' : 'out', 'call', text, 'completed', b.call_id || b.callId || null, auth && auth.sub).run();
  return json({ ok: true, id });
}
// click-to-call: сначала звонит телефон менеджера (internalNumber), затем набирается клиент.
// Если Binotel не настроен — отвечаем fallback:true, и фронт открывает tel:.
async function binotelCall(env, request, auth) {
  const b = await request.json().catch(() => ({}));
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  if (!phone) return err(400, 'Не указан телефон');
  const { key, secret, ext } = await binotelCreds(env);
  const internal = String(b.from || ext || '').trim();
  if (!key || !secret) return json({ ok: false, fallback: true, reason: 'no-creds' });
  if (!internal) return json({ ok: false, fallback: true, reason: 'no-ext' });
  let ok = false, info = '';
  try {
    const res = await fetch(`${BINOTEL_API}/calls/call-to-customer.json`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, secret, internalNumber: internal, telephone: phone }),
    });
    const data = await res.json().catch(() => null);
    ok = !!(data && data.status === 'success');
    info = (data && (data.message || data.callId)) || ('HTTP ' + res.status);
    try {
      await ensureMessagesSchema(env);
      await env.DB.prepare(
        `INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`
      ).bind(genId(), b.dealId || null, b.clientId || null, '+' + phone, 'out', 'call', 'Исходящий звонок', ok ? 'initiated' : 'error', (data && data.callId) || null, auth && auth.sub).run();
    } catch (e) {}
  } catch (e) { return json({ ok: false, fallback: true, reason: String((e && e.message) || e) }); }
  return ok ? json({ ok: true }) : json({ ok: false, fallback: true, reason: info });
}
// webhook входящего звонка Binotel → клиент по номеру + лог (+ сделка, как у WhatsApp).
async function binotelWebhook(env, request, url) {
  await ensureMessagesSchema(env); await ensureAppSettings(env); await ensureArchiveColumns(env);
  const wt = await getSetting(env, 'binotel_webhook_token');
  if (wt && url.searchParams.get('token') !== wt) return err(403, 'Неверный токен webhook');
  let body = {};
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) body = await request.json();
    else { const p = new URLSearchParams(await request.text()); body = Object.fromEntries(p.entries()); }
  } catch (e) {}
  const raw = body.callerIDExternal || body.externalNumber || body.from || body.CallerIDNumber || body.callerID || '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return json({ ok: true, skipped: 'no-phone' });
  const dir = String(body.callType || body.direction || '').toLowerCase();
  if (dir && !/in|вход|^0$/.test(dir)) return json({ ok: true, skipped: 'not-incoming' });

  const { clientId, created } = await findOrCreateClientByPhone(env, digits, '');
  let dealId = await openDealForClient(env, clientId);
  let newDeal = false;
  if (!dealId) { dealId = await createIncomingDeal(env, clientId, 'Входящий звонок'); newDeal = true; }
  await env.DB.prepare(
    `INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).bind(genId(), dealId, clientId, '+' + digits, 'in', 'call', 'Входящий звонок', 'received', body.generalCallID || body.callId || null, null).run();
  return json({ ok: true, clientId, dealId, newClient: created, newDeal });
}

// Round Robin: следующий активный менеджер (role_key='manager', active=1), не из списка исключённых.
async function pickRoundRobinManager(env) {
  if ((await getSetting(env, 'autodistribute')) === '0') return null; // распределение выключено
  let excluded = []; try { excluded = JSON.parse((await getSetting(env, 'autodistribute_excluded')) || '[]'); } catch (e) {}
  const r = await env.DB.prepare("SELECT id FROM users WHERE role_key='manager' AND active=1 ORDER BY id").all();
  const managers = (r.results || []).map((x) => x.id).filter((id) => !excluded.includes(id));
  if (!managers.length) return null;
  const last = await getSetting(env, 'roundrobin_last');
  const idx = managers.indexOf(last);                 // -1, если последнего нет в списке
  const next = managers[(idx + 1) % managers.length]; // следующий по кругу (или первый)
  await setSetting(env, 'roundrobin_last', next);
  return next;
}

// Онбординг: разовое распределение базы клиентов по менеджерам поровну (round-robin).
// body: { onlyUnassigned: true (по умолчанию) — только без ответственного; false — переназначить всех;
//         excluded: [userId,...] — кого не включать }.
async function distributeClients(env, request) {
  const body = await request.json().catch(() => ({}));
  const onlyUnassigned = body.onlyUnassigned !== false;
  let excluded = Array.isArray(body.excluded) ? body.excluded : [];
  const mr = await env.DB.prepare("SELECT id FROM users WHERE role_key='manager' AND active=1 ORDER BY id").all();
  const managers = (mr.results || []).map((x) => x.id).filter((id) => !excluded.includes(id));
  if (!managers.length) return err(400, 'Нет активных менеджеров для распределения');

  const where = onlyUnassigned ? "WHERE manager_id IS NULL OR manager_id=''" : '';
  const cr = await env.DB.prepare(`SELECT id FROM clients ${where} ORDER BY name`).all();
  const ids = (cr.results || []).map((x) => x.id);
  const stmts = [];
  let i = 0;
  for (const cid of ids) {
    const mgr = managers[i % managers.length];
    stmts.push(env.DB.prepare('UPDATE clients SET manager_id=? WHERE id=?').bind(mgr, cid));
    i++;
  }
  for (let j = 0; j < stmts.length; j += 100) await env.DB.batch(stmts.slice(j, j + 100));
  // следующее авто-распределение продолжит круг с последнего назначенного
  if (ids.length) await setSetting(env, 'roundrobin_last', managers[(ids.length - 1) % managers.length]);
  return json({ assigned: ids.length, managers: managers.length, onlyUnassigned });
}

// Клиент по номеру телефона: ищем по совпадению цифр (и по последним 10), иначе создаём нового.
async function findOrCreateClientByPhone(env, digits, name) {
  const norm = (s) => String(s || '').replace(/\D/g, '');
  const all = await env.DB.prepare('SELECT id, phone FROM clients').all();
  const rows = all.results || [];
  for (const c of rows) { if (c.phone && norm(c.phone) === digits) return { clientId: c.id, created: false }; }
  const tail = digits.slice(-10);
  if (tail.length === 10) for (const c of rows) { if (c.phone && norm(c.phone).slice(-10) === tail) return { clientId: c.id, created: false }; }
  const id = genId();
  const cname = ((name && name.trim()) || ('WhatsApp +' + digits)).slice(0, 150);
  await env.DB.prepare("INSERT INTO clients (id, name, phone, created_at) VALUES (?,?,?,datetime('now'))").bind(id, cname, '+' + digits).run();
  return { clientId: id, created: true };
}

// Активная (незавершённая) сделка клиента — чтобы не плодить сделки на каждое сообщение.
// Сделку в ЗАХАРДКОЖЕННОМ (protected) терминальном этапе — Оплачено/Отгружено/Отказ —
// активной не считаем: после неё новое обращение клиента открывает НОВУЮ сделку.
async function openDealForClient(env, clientId) {
  const r = await env.DB.prepare(
    `SELECT d.id FROM deals d JOIN deal_stages s ON s.id = d.stage_id
     WHERE d.client_id = ? AND (d.archived_at IS NULL OR d.archived_at = '')
       AND (s.protected IS NULL OR s.protected = 0 OR lower(s.label) LIKE '%резерв%')
       AND s.label NOT LIKE '%акры%' AND s.label NOT LIKE '%тказ%' AND s.label NOT LIKE '%роигр%'
     ORDER BY d.created_at DESC LIMIT 1`
  ).bind(clientId).first();
  return r ? r.id : null;
}

// Новая сделка из входящего сообщения: первый этап воронки + менеджер.
// Закрепление за менеджером: если у клиента уже есть ответственный (clients.manager_id) —
// берём его (повторные обращения идут к тому же); иначе назначаем по Round Robin и
// СРАЗУ закрепляем менеджера за клиентом, чтобы дальше обращения шли к нему.
async function createIncomingDeal(env, clientId, text) {
  const stage = await env.DB.prepare('SELECT id FROM deal_stages ORDER BY sort, rowid LIMIT 1').first();
  if (!stage || !stage.id) throw new Error('нет этапов воронки');
  let mgr = null;
  try { const c = await env.DB.prepare('SELECT manager_id FROM clients WHERE id=?').bind(clientId).first(); if (c && c.manager_id) mgr = c.manager_id; } catch (e) {}
  if (!mgr) {
    mgr = await pickRoundRobinManager(env);
    if (mgr) { try { await env.DB.prepare("UPDATE clients SET manager_id=? WHERE id=? AND (manager_id IS NULL OR manager_id='')").bind(mgr, clientId).run(); } catch (e) {} }
  }
  const id = genId();
  const no = 'WA-' + Date.now();
  const title = (String(text || '').trim().slice(0, 60)) || 'Заявка из WhatsApp';
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO deals (id, no, title, client_id, manager_id, stage_id, amount, items, created, created_at)
     VALUES (?,?,?,?,?,?,0,0,?,datetime('now'))`
  ).bind(id, no, title, clientId, mgr, stage.id, today).run();
  try { await env.DB.prepare('INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, user_id) VALUES (?,?,?,?)').bind(id, null, stage.id, null).run(); } catch (e) {}
  // уведомление о новой заявке — ответственному менеджеру и директорам (идемпотентно по ref)
  try {
    await ensureNotifSchema(env);
    const recips = new Set();
    if (mgr) recips.add(mgr);
    const dirs = await env.DB.prepare("SELECT id FROM users WHERE role_key='director' AND active=1").all();
    for (const u of (dirs.results || [])) recips.add(u.id);
    const txt = 'Новая заявка: ' + title;
    const stmts = [];
    for (const uid of recips) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (text, type, read, created_at, user_id, ref) VALUES (?, 'info', 0, datetime('now'), ?, ?)").bind(txt, uid, `newdeal:${id}:${uid}`));
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  } catch (e) {}
  return id;
}

// Webhook Green API: входящее сообщение -> клиент (если нет) + сделка (если нет открытой) + лог.
async function greenapiWebhook(env, request, url) {
  await ensureMessagesSchema(env); await ensureAppSettings(env); await ensureArchiveColumns(env);
  const wt = await getSetting(env, 'greenapi_webhook_token');
  if (wt && url.searchParams.get('token') !== wt) return err(403, 'Неверный токен webhook');
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: true });
  if (body.typeWebhook !== 'incomingMessageReceived') return json({ ok: true, skipped: body.typeWebhook || 'none' });
  const chatId = (body.senderData && body.senderData.chatId) || '';
  if (!/@c\.us$/.test(String(chatId))) return json({ ok: true, skipped: 'not-private' }); // групповые чаты игнорируем
  const digits = String(chatId).replace(/@c\.us$/, '').replace(/\D/g, '');
  if (!digits) return json({ ok: true, skipped: 'no-phone' });
  const senderName = (body.senderData && body.senderData.senderName) || '';
  const md = body.messageData || {};
  let text = '', fileUrl = null;
  if (md.textMessageData) text = md.textMessageData.textMessage || '';
  else if (md.extendedTextMessageData) text = md.extendedTextMessageData.text || '';
  else if (md.fileMessageData) { fileUrl = md.fileMessageData.downloadUrl || null; text = md.fileMessageData.caption || md.fileMessageData.fileName || '[файл]'; }
  else text = '[' + (md.typeMessage || 'сообщение') + ']';

  const { clientId, created } = await findOrCreateClientByPhone(env, digits, senderName);
  let dealId = await openDealForClient(env, clientId);
  let newDeal = false;
  if (!dealId) { dealId = await createIncomingDeal(env, clientId, text); newDeal = true; }

  await env.DB.prepare(
    `INSERT INTO messages (id, deal_id, client_id, phone, direction, channel, text, status, ext_id, user_id, file_url, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).bind(genId(), dealId, clientId, '+' + digits, 'in', 'whatsapp', text, 'received', body.idMessage || null, null, fileUrl).run();

  return json({ ok: true, clientId, dealId, newClient: created, newDeal });
}

// Агрегаты раздела «Отчёты» — считаются в SQL по данным CRM (сделки/позиции).
// «Выигранные» сделки: этапы paid/shipped/closed.
async function reportsSummary(env, url) {
  await ensureArchiveColumns(env); // архивные (удалённые) сделки в отчёты не попадают
  const p = (url && url.searchParams) || new URLSearchParams();
  const manager = (p.get('manager') || '').trim();
  const from = (p.get('from') || '').trim();
  const to = (p.get('to') || '').trim();
  const stages = (p.get('stages') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const minSum = (p.get('minSum') || '').trim();
  const maxSum = (p.get('maxSum') || '').trim();
  const pipeline = (p.get('pipeline') || '').trim();

  // Конструктор условий WHERE с учётом фильтров (менеджер, диапазон дат, этапы, сумма, воронка).
  //   alias — префикс таблицы deals ('' или 'd'). Без выбранных этапов берём ВСЕ сделки
  //   (реальные данные CRM); этап/воронка сужают выборку.
  const condsFor = (alias) => {
    const col = (c) => (alias ? `${alias}.${c}` : c);
    const conds = [`${col('archived_at')} IS NULL`];
    const args = [];
    if (manager) { conds.push(`${col('manager_id')} = ?`); args.push(manager); }
    if (from) { conds.push(`substr(${col('created')},1,10) >= ?`); args.push(from); }
    if (to) { conds.push(`substr(${col('created')},1,10) <= ?`); args.push(to); }
    if (minSum !== '') { conds.push(`${col('amount')} >= ?`); args.push(Number(minSum) || 0); }
    if (maxSum !== '') { conds.push(`${col('amount')} <= ?`); args.push(Number(maxSum) || 0); }
    if (pipeline) { conds.push(`${col('stage_id')} IN (SELECT id FROM deal_stages WHERE pipeline_id = ?)`); args.push(pipeline); }
    if (stages.length) {
      conds.push(`${col('stage_id')} IN (${stages.map(() => '?').join(',')})`);
      args.push(...stages);
    }
    return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', args };
  };

  const cStage = condsFor('');
  const byStage = await env.DB.prepare(
    `SELECT stage_id, COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum FROM deals ${cStage.where} GROUP BY stage_id`
  ).bind(...cStage.args).all();

  const cMgr = condsFor('');
  const byManager = await env.DB.prepare(
    `SELECT manager_id, COUNT(*) AS count, COALESCE(SUM(amount),0) AS sum
       FROM deals ${cMgr.where} GROUP BY manager_id`
  ).bind(...cMgr.args).all();

  const cCat = condsFor('d');
  const byCategory = await env.DB.prepare(
    `SELECT COALESCE(c.name,'Без категории') AS category, COALESCE(SUM(di.qty * di.price_used),0) AS sum
       FROM deal_items di
       JOIN deals d ON d.id = di.deal_id
       LEFT JOIN products p ON p.id = di.product_id
       LEFT JOIN product_categories c ON c.id = p.category_id
      ${cCat.where}
      GROUP BY c.name HAVING sum > 0 ORDER BY sum DESC`
  ).bind(...cCat.args).all();

  const cMon = condsFor('');
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

// Суммарный остаток товара по всем складам
async function stockOf(env, productId) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(stock),0) AS stock FROM product_stock WHERE product_id=?').bind(productId).first();
  return row ? num(row.stock) : 0;
}
// Изменить остаток товара на delta (не ниже 0). Обновляем СУЩЕСТВУЮЩУЮ строку
// (любой склад), иначе изменение не отразится в суммарном остатке.
async function adjustStock(env, productId, delta) {
  const row = await env.DB.prepare('SELECT warehouse_id, stock FROM product_stock WHERE product_id=? ORDER BY stock DESC LIMIT 1').bind(productId).first();
  if (row) {
    const newStock = Math.max(0, num(row.stock) + delta);
    await env.DB.prepare('UPDATE product_stock SET stock=? WHERE product_id=? AND warehouse_id=?').bind(newStock, productId, row.warehouse_id).run();
    return newStock;
  }
  const newStock = Math.max(0, delta);
  try { await env.DB.prepare('INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?, ?, ?, 0)').bind(productId, 'w1', newStock).run(); } catch (e) {}
  return newStock;
}
// Изменить резерв товара на delta (не ниже 0) — на той же строке склада, что и остаток.
async function adjustReserved(env, productId, delta) {
  if (!delta) return;
  const row = await env.DB.prepare('SELECT warehouse_id, reserved FROM product_stock WHERE product_id=? ORDER BY stock DESC LIMIT 1').bind(productId).first();
  if (row) {
    const nv = Math.max(0, num(row.reserved) + delta);
    await env.DB.prepare('UPDATE product_stock SET reserved=? WHERE product_id=? AND warehouse_id=?').bind(nv, productId, row.warehouse_id).run();
    return nv;
  }
  if (delta > 0) { try { await env.DB.prepare("INSERT INTO product_stock (product_id, warehouse_id, stock, reserved) VALUES (?, 'w1', 0, ?)").bind(productId, Math.max(0, delta)).run(); } catch (e) {} }
  return Math.max(0, delta);
}

// Резерв товаров под сделку. Хранит, сколько зарезервировано по каждой сделке
// (deal_reservations), чтобы повторный «Резерв» не задваивал, а снятие/удаление —
// корректно освобождало. reserved в product_stock держим = сумме резервов сделок.
let RESV_SCHEMA_OK = false;
async function ensureReservationsSchema(env) {
  if (RESV_SCHEMA_OK) return;
  try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS deal_reservations (deal_id TEXT, product_id TEXT, qty REAL, PRIMARY KEY (deal_id, product_id))').run(); } catch (e) {}
  RESV_SCHEMA_OK = true;
}
// Привести резерв сделки к её текущим позициям (release=true — снять весь резерв сделки).
async function reserveDeal(env, dealId, release) {
  await ensureReservationsSchema(env);
  const cur = await env.DB.prepare('SELECT product_id, qty FROM deal_reservations WHERE deal_id=?').bind(dealId).all();
  const curMap = {}; for (const r of (cur.results || [])) curMap[r.product_id] = num(r.qty);

  const want = {};
  if (!release) {
    const items = await env.DB.prepare('SELECT product_id, qty FROM deal_items WHERE deal_id=?').bind(dealId).all();
    for (const it of (items.results || [])) { if (!it.product_id) continue; want[it.product_id] = (want[it.product_id] || 0) + num(it.qty); }
  }
  const pids = new Set([...Object.keys(curMap), ...Object.keys(want)]);
  for (const pid of pids) { const delta = (want[pid] || 0) - (curMap[pid] || 0); if (delta) await adjustReserved(env, pid, delta); }

  await env.DB.prepare('DELETE FROM deal_reservations WHERE deal_id=?').bind(dealId).run();
  const stmts = [];
  for (const pid of Object.keys(want)) if (want[pid] > 0) stmts.push(env.DB.prepare('INSERT INTO deal_reservations (deal_id, product_id, qty) VALUES (?,?,?)').bind(dealId, pid, want[pid]));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  if (release) {
    // снятие резерва — останавливаем срок и убираем уведомления об истечении
    try { await env.DB.prepare('UPDATE deals SET reserved_at=NULL WHERE id=?').bind(dealId).run(); } catch (e) {}
    try { await env.DB.prepare("DELETE FROM notifications WHERE ref LIKE ?").bind(`reserveexp:${dealId}:%`).run(); } catch (e) {}
  }
  const totalQty = Object.values(want).reduce((s, v) => s + v, 0);
  return json({ ok: true, released: !!release, products: Object.keys(want).length, totalQty });
}
// Какие сделки держат резерв по товару (для проваливания со склада).
async function getProductReservations(env, productId) {
  await ensureReservationsSchema(env);
  const r = await env.DB.prepare(
    `SELECT dr.qty AS qty, d.id AS deal_id, d.no AS no, d.title AS title, d.manager_id AS manager_id, c.name AS client_name
       FROM deal_reservations dr
       JOIN deals d ON d.id = dr.deal_id
       LEFT JOIN clients c ON c.id = d.client_id
      WHERE dr.product_id=? ORDER BY dr.qty DESC`
  ).bind(productId).all();
  return json({ reservations: r.results || [] });
}

// --------------------------------------------------------------------------
// Движения склада (приход/расход) — журнал + корректировка остатка product_stock.
// --------------------------------------------------------------------------
let MOVEMENTS_SCHEMA_OK = false;
async function ensureMovementsSchema(env) {
  if (MOVEMENTS_SCHEMA_OK) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY, product_id TEXT, direction TEXT, type TEXT, qty REAL,
      date TEXT, doc_no TEXT, counterparty TEXT, note TEXT, created_by TEXT, created_at TEXT
    )`).run();
  } catch (e) {}
  try { await env.DB.prepare('ALTER TABLE stock_movements ADD COLUMN doc_id TEXT').run(); } catch (e) {}
  // документы склада (приход/расход) со статусами draft → posted → cancelled
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stock_docs (
      id TEXT PRIMARY KEY, type TEXT, no TEXT, date TEXT, counterparty TEXT, note TEXT,
      status TEXT DEFAULT 'draft', items TEXT, total_qty REAL DEFAULT 0,
      created_by TEXT, created_at TEXT, posted_at TEXT, cancelled_at TEXT
    )`).run();
  } catch (e) {}
  try { await env.DB.prepare('ALTER TABLE stock_docs ADD COLUMN deal_id TEXT').run(); } catch (e) {}
  MOVEMENTS_SCHEMA_OK = true;
}

// ----- Документы склада (приход/расход) -----
async function enrichDocItems(env, items) {
  const out = [];
  for (const it of (items || [])) {
    const pid = it.product_id || it.productId;
    const qty = num(it.qty);
    if (!pid || qty <= 0) continue;
    const p = await env.DB.prepare('SELECT id, name, sku FROM products WHERE id=?').bind(pid).first();
    if (!p) continue;
    out.push({ product_id: p.id, product_name: p.name, product_sku: p.sku, qty });
  }
  return out;
}
async function nextDocNo(env, type) {
  const prefix = type === 'receipt' ? 'ПР' : 'РС';
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM stock_docs WHERE type=?').bind(type).first();
  return prefix + '-' + String(((row && row.n) || 0) + 1).padStart(4, '0');
}
function parseDoc(d) { try { d.items = JSON.parse(d.items || '[]'); } catch (e) { d.items = []; } return d; }

async function listStockDocs(env, url) {
  const type = (url.searchParams.get('type') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);
  const conds = [], args = [];
  if (type) { conds.push('type=?'); args.push(type); }
  if (status) { conds.push('status=?'); args.push(status); }
  const ws = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const r = await env.DB.prepare(
    `SELECT id, type, no, date, counterparty, note, status, total_qty, created_at, posted_at FROM stock_docs ${ws} ORDER BY created_at DESC LIMIT ?`
  ).bind(...args, limit).all();
  return json(r.results);
}
async function getStockDoc(env, id) {
  const d = await env.DB.prepare('SELECT * FROM stock_docs WHERE id=?').bind(id).first();
  if (!d) return err(404, 'Документ не найден');
  return json(parseDoc(d));
}
async function createStockDoc(env, request, auth) {
  const b = await request.json().catch(() => ({}));
  const type = b.type === 'writeoff' ? 'writeoff' : 'receipt';
  const items = await enrichDocItems(env, b.items);
  const id = genId();
  const now = new Date().toISOString();
  const no = await nextDocNo(env, type);
  const totalQty = items.reduce((s, it) => s + num(it.qty), 0);
  await env.DB.prepare(
    `INSERT INTO stock_docs (id, type, no, date, counterparty, note, status, items, total_qty, created_by, created_at)
     VALUES (?,?,?,?,?,?, 'draft', ?,?,?,?)`
  ).bind(id, type, no, b.date || now.slice(0, 10), b.counterparty || '', b.note || '', JSON.stringify(items), totalQty, auth ? auth.sub : null, now).run();
  return getStockDoc(env, id);
}
async function updateStockDoc(env, request, id) {
  const d = await env.DB.prepare('SELECT status FROM stock_docs WHERE id=?').bind(id).first();
  if (!d) return err(404, 'Документ не найден');
  if (d.status !== 'draft') return err(400, 'Редактировать можно только черновик');
  const b = await request.json().catch(() => ({}));
  const items = await enrichDocItems(env, b.items);
  const totalQty = items.reduce((s, it) => s + num(it.qty), 0);
  await env.DB.prepare('UPDATE stock_docs SET date=?, counterparty=?, note=?, items=?, total_qty=? WHERE id=?')
    .bind(b.date || '', b.counterparty || '', b.note || '', JSON.stringify(items), totalQty, id).run();
  return getStockDoc(env, id);
}
async function deleteStockDoc(env, id) {
  const d = await env.DB.prepare('SELECT status FROM stock_docs WHERE id=?').bind(id).first();
  if (!d) return err(404, 'Документ не найден');
  if (d.status !== 'draft') return err(400, 'Удалить можно только черновик');
  await env.DB.prepare('DELETE FROM stock_docs WHERE id=?').bind(id).run();
  return json({ deleted: 1 });
}
async function postStockDoc(env, id, auth) {
  const d = await env.DB.prepare('SELECT * FROM stock_docs WHERE id=?').bind(id).first();
  if (!d) return err(404, 'Документ не найден');
  if (d.status !== 'draft') return err(400, 'Провести можно только черновик');
  const items = parseDoc({ ...d }).items;
  if (!items.length) return err(400, 'В документе нет позиций');
  const dir = d.type === 'receipt' ? 'in' : 'out';
  if (dir === 'out') {
    for (const it of items) {
      const stock = await stockOf(env, it.product_id);
      if (num(it.qty) > stock) return err(400, `Недостаточно остатка по «${it.product_name}»: на складе ${stock}`);
    }
  }
  const now = new Date().toISOString();
  for (const it of items) {
    await adjustStock(env, it.product_id, dir === 'in' ? num(it.qty) : -num(it.qty));
    await env.DB.prepare(`INSERT INTO stock_movements (id, product_id, direction, type, qty, date, doc_no, counterparty, note, created_by, created_at, doc_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(genId(), it.product_id, dir, d.type, num(it.qty), d.date, d.no, d.counterparty, d.note, auth ? auth.sub : null, now, d.id).run();
  }
  await env.DB.prepare("UPDATE stock_docs SET status='posted', posted_at=? WHERE id=?").bind(now, id).run();
  return getStockDoc(env, id);
}
async function cancelStockDoc(env, id, auth) {
  const d = await env.DB.prepare('SELECT * FROM stock_docs WHERE id=?').bind(id).first();
  if (!d) return err(404, 'Документ не найден');
  if (d.status !== 'posted') return err(400, 'Отменить можно только проведённый документ');
  const items = parseDoc({ ...d }).items;
  const dir = d.type === 'receipt' ? 'in' : 'out';
  const now = new Date().toISOString();
  for (const it of items) { // восстановление симметрично: приход → −, расход → +
    await adjustStock(env, it.product_id, dir === 'in' ? -num(it.qty) : num(it.qty));
    await env.DB.prepare(`INSERT INTO stock_movements (id, product_id, direction, type, qty, date, doc_no, counterparty, note, created_by, created_at, doc_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(genId(), it.product_id, dir === 'in' ? 'out' : 'in', d.type, num(it.qty), now.slice(0, 10), d.no, d.counterparty, 'Отмена документа', auth ? auth.sub : null, now, d.id).run();
  }
  await env.DB.prepare("UPDATE stock_docs SET status='cancelled', cancelled_at=? WHERE id=?").bind(now, id).run();
  return getStockDoc(env, id);
}

// Автосписание по сделке при переходе на этап «Отгружено»: создаёт проведённый
// расходный документ (накладную) из позиций сделки и списывает остаток. Идемпотентно.
async function autoShipDeal(env, dealId, auth) {
  await ensureMovementsSchema(env);
  const existing = await env.DB.prepare("SELECT id FROM stock_docs WHERE deal_id=? AND type='writeoff' AND status='posted'").bind(dealId).first();
  if (existing) return existing.id; // уже отгружено — не дублируем
  const itemsRows = await env.DB.prepare('SELECT product_id, qty FROM deal_items WHERE deal_id=?').bind(dealId).all();
  const items = [];
  for (const it of (itemsRows.results || [])) {
    const p = await env.DB.prepare('SELECT id, name, sku FROM products WHERE id=?').bind(it.product_id).first();
    if (p && num(it.qty) > 0) items.push({ product_id: p.id, product_name: p.name, product_sku: p.sku, qty: num(it.qty) });
  }
  if (!items.length) return null; // нечего списывать
  const deal = await env.DB.prepare('SELECT no, client_id FROM deals WHERE id=?').bind(dealId).first();
  let clientName = '';
  if (deal && deal.client_id) { const c = await env.DB.prepare('SELECT name FROM clients WHERE id=?').bind(deal.client_id).first(); clientName = c ? c.name : ''; }

  const id = genId();
  const now = new Date().toISOString();
  const no = await nextDocNo(env, 'writeoff');
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  await env.DB.prepare(
    `INSERT INTO stock_docs (id, type, no, date, counterparty, note, status, items, total_qty, deal_id, created_by, created_at, posted_at)
     VALUES (?,?,?,?,?,?, 'posted', ?,?,?,?,?,?)`
  ).bind(id, 'writeoff', no, now.slice(0, 10), clientName || '', 'Отгрузка по сделке ' + (deal ? deal.no : ''), JSON.stringify(items), totalQty, dealId, auth ? auth.sub : null, now, now).run();

  for (const it of items) {
    await adjustStock(env, it.product_id, -it.qty); // списываем со склада (не ниже 0)
    await env.DB.prepare(`INSERT INTO stock_movements (id, product_id, direction, type, qty, date, doc_no, counterparty, note, created_by, created_at, doc_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(genId(), it.product_id, 'out', 'sale', it.qty, now.slice(0, 10), no, clientName || '', 'Отгрузка по сделке', auth ? auth.sub : null, now, id).run();
  }
  return id;
}

async function listMovements(env, url) {
  const product = (url.searchParams.get('product') || '').trim();
  const from = (url.searchParams.get('from') || '').trim();
  const to = (url.searchParams.get('to') || '').trim();
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 1000);
  const conds = [], args = [];
  if (product) { conds.push('m.product_id = ?'); args.push(product); }
  if (from) { conds.push('substr(m.date,1,10) >= ?'); args.push(from); }
  if (to) { conds.push('substr(m.date,1,10) <= ?'); args.push(to); }
  const ws = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const r = await env.DB.prepare(
    `SELECT m.*, p.name AS product_name, p.sku AS product_sku
       FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id
      ${ws} ORDER BY m.created_at DESC LIMIT ?`
  ).bind(...args, limit).all();
  return json(r.results);
}

// Приход (direction=in) увеличивает остаток, расход (out) — уменьшает (не ниже 0).
async function createMovement(env, request, auth) {
  const b = await request.json().catch(() => ({}));
  const productId = b.product_id || b.productId;
  const direction = b.direction === 'out' ? 'out' : 'in';
  const qty = num(b.qty);
  if (!productId) return err(400, 'Не указан товар');
  if (qty <= 0) return err(400, 'Количество должно быть больше 0');
  const prod = await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(productId).first();
  if (!prod) return err(404, 'Товар не найден');

  const stock = await stockOf(env, productId);
  if (direction === 'out' && qty > stock) return err(400, `Недостаточно остатка: на складе ${stock}`);
  const newStock = await adjustStock(env, productId, direction === 'in' ? qty : -qty);

  const id = genId();
  const now = new Date().toISOString();
  const date = (b.date || now.slice(0, 10));
  const type = b.type || (direction === 'in' ? 'receipt' : 'writeoff');
  await env.DB.prepare(
    `INSERT INTO stock_movements (id, product_id, direction, type, qty, date, doc_no, counterparty, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, productId, direction, type, qty, date, b.doc_no || '', b.counterparty || '', b.note || '', auth ? auth.sub : null, now).run();

  return json({ id, product_id: productId, direction, type, qty, stock: newStock, balanceAfter: newStock }, 201);
}

// --------------------------------------------------------------------------
// Удаление сделки: отвязываем счета/отгрузки/задачи, чистим позиции и историю.
// Доступ: только директор.
// Список сделок (без архивных)
async function listDeals(env, url) {
  await ensureArchiveColumns(env);
  const limit = clampInt(url.searchParams.get('limit'), 500, 1, 1000);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1e9);
  const r = await env.DB.prepare('SELECT * FROM deals WHERE archived_at IS NULL LIMIT ? OFFSET ?').bind(limit, offset).all();
  return json(r.results);
}

// «Удаление» сделки = мягкое перемещение в архив (связи и позиции сохраняются)
async function deleteDeal(env, id, auth) {
  const d = await env.DB.prepare(`SELECT id FROM deals WHERE id=?`).bind(id).first();
  if (!d) return err(404, 'Сделка не найдена');
  if (auth.role !== 'director') return err(403, 'Удалять сделки может только директор');
  await ensureArchiveColumns(env);
  try { await reserveDeal(env, id, true); } catch (e) {} // освобождаем резерв при архивации
  await env.DB.prepare('UPDATE deals SET archived_at=? WHERE id=?').bind(new Date().toISOString(), id).run();
  return json({ archived: 1, id });
}

// «Удаление» клиента = мягкое перемещение в архив
async function deleteClient(env, id, auth) {
  const c = await env.DB.prepare('SELECT id FROM clients WHERE id=?').bind(id).first();
  if (!c) return err(404, 'Клиент не найден');
  if (!auth || auth.role !== 'director') return err(403, 'Удалять клиентов может только директор');
  await ensureArchiveColumns(env);
  await env.DB.prepare('UPDATE clients SET archived_at=? WHERE id=?').bind(new Date().toISOString(), id).run();
  return json({ archived: 1, id });
}

// Список счетов (без архивных)
async function listInvoices(env, url) {
  await ensureArchiveColumns(env);
  const limit = clampInt(url.searchParams.get('limit'), 500, 1, 1000);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1e9);
  const r = await env.DB.prepare('SELECT * FROM invoices WHERE archived_at IS NULL LIMIT ? OFFSET ?').bind(limit, offset).all();
  return json(r.results);
}

// «Удаление» счёта = мягкое перемещение в архив (можно восстановить)
async function deleteInvoice(env, id, auth) {
  const iv = await env.DB.prepare('SELECT id FROM invoices WHERE id=?').bind(id).first();
  if (!iv) return err(404, 'Счёт не найден');
  if (!auth || auth.role !== 'director') return err(403, 'Удалять счета может только директор');
  await ensureArchiveColumns(env);
  await env.DB.prepare('UPDATE invoices SET archived_at=? WHERE id=?').bind(new Date().toISOString(), id).run();
  return json({ archived: 1, id });
}

// ----- Архив (сделки/клиенты) -----
// Право доступа «Архив» — по модулю 'archive' в роли пользователя
async function roleHasModule(env, auth, mod) {
  if (!auth) return false;
  const r = await env.DB.prepare('SELECT modules FROM roles WHERE key=?').bind(auth.role).first();
  if (!r) return false;
  try { return JSON.parse(r.modules || '[]').includes(mod); } catch (e) { return false; }
}
// Одноразово выдаём право «Архив» директору (чтобы он не потерял доступ при вводе права)
let ARCHIVE_RIGHT_OK = false;
async function ensureArchiveRight(env) {
  if (ARCHIVE_RIGHT_OK) return;
  const dir = await env.DB.prepare("SELECT modules FROM roles WHERE key='director'").first();
  if (dir) {
    let mods = []; try { mods = JSON.parse(dir.modules || '[]'); } catch (e) {}
    if (!mods.includes('archive')) { mods.push('archive'); await env.DB.prepare("UPDATE roles SET modules=? WHERE key='director'").bind(JSON.stringify(mods)).run(); }
  }
  ARCHIVE_RIGHT_OK = true;
}

let ARCHIVE_SCHEMA_OK = false;
async function ensureArchiveColumns(env) {
  if (ARCHIVE_SCHEMA_OK) return;
  for (const ddl of ['ALTER TABLE deals ADD COLUMN archived_at TEXT', 'ALTER TABLE clients ADD COLUMN archived_at TEXT', 'ALTER TABLE invoices ADD COLUMN archived_at TEXT']) {
    try { await env.DB.prepare(ddl).run(); } catch (e) {}
  }
  ARCHIVE_SCHEMA_OK = true;
}
async function listArchive(env) {
  const deals = await env.DB.prepare('SELECT id, no, title, client_id, manager_id, stage_id, amount, archived_at FROM deals WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();
  const clients = await env.DB.prepare('SELECT id, name, bin, type_key, city, manager_id, archived_at FROM clients WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();
  const invoices = await env.DB.prepare('SELECT id, no, client_id, deal_id, amount, due, status_id, archived_at FROM invoices WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();
  return json({ deals: deals.results, clients: clients.results, invoices: invoices.results });
}
async function restoreArchive(env, request) {
  const b = await request.json().catch(() => ({}));
  if (!b.id || !['deal', 'client', 'invoice'].includes(b.type)) return err(400, 'Некорректный запрос');
  const table = b.type === 'deal' ? 'deals' : b.type === 'client' ? 'clients' : 'invoices';
  await env.DB.prepare(`UPDATE ${table} SET archived_at=NULL WHERE id=?`).bind(b.id).run();
  return json({ restored: 1, type: b.type, id: b.id });
}
// По истечении 30 дней — окончательное удаление с очисткой связей
async function purgeExpiredArchive(env) {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const oldDeals = await env.DB.prepare('SELECT id FROM deals WHERE archived_at IS NOT NULL AND archived_at < ?').bind(cutoff).all();
  for (const d of oldDeals.results) {
    await env.DB.batch([
      env.DB.prepare('UPDATE invoices SET deal_id=NULL WHERE deal_id=?').bind(d.id),
      env.DB.prepare('UPDATE shipments SET deal_id=NULL WHERE deal_id=?').bind(d.id),
      env.DB.prepare('UPDATE tasks SET deal_id=NULL WHERE deal_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM deal_items WHERE deal_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM deal_stage_history WHERE deal_id=?').bind(d.id),
      env.DB.prepare('DELETE FROM deals WHERE id=?').bind(d.id),
    ]);
  }
  const oldClients = await env.DB.prepare('SELECT id FROM clients WHERE archived_at IS NOT NULL AND archived_at < ?').bind(cutoff).all();
  for (const c of oldClients.results) {
    await env.DB.batch([
      env.DB.prepare('UPDATE deals SET client_id=NULL WHERE client_id=?').bind(c.id),
      env.DB.prepare('DELETE FROM client_tags WHERE client_id=?').bind(c.id),
      env.DB.prepare('DELETE FROM clients WHERE id=?').bind(c.id),
    ]);
  }
  // Архивные счета старше 30 дней — окончательно удаляем
  const oldInv = await env.DB.prepare('SELECT id FROM invoices WHERE archived_at IS NOT NULL AND archived_at < ?').bind(cutoff).all();
  for (const iv of oldInv.results) {
    await env.DB.prepare('DELETE FROM invoices WHERE id=?').bind(iv.id).run();
  }
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
  // текущие резервы сделки (для пометки «в резерве» в карточке)
  try {
    const rv = await env.DB.prepare('SELECT product_id, qty FROM deal_reservations WHERE deal_id=?').bind(id).all();
    deal.reservations = rv.results || [];
  } catch (e) { deal.reservations = []; }
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
    data.items = lineItems.reduce((s, it) => s + num(it.qty), 0);
    // сумму считаем сами только если клиент её не прислал; иначе уважаем общую сумму
    // сделки (база + позиции), которую посчитал фронт
    if (data.amount == null || data.amount === '') {
      data.amount = lineItems.reduce((s, it) => s + num(it.qty) * num(it.price_used != null ? it.price_used : it.priceUsed), 0);
    }
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
    // Синхронизация статуса связанной отгрузки при смене этапа.
    // ВРЕМЕННО ОТКЛЮЧЕНО (по запросу): автосоздание документов на этапах
    // «Оплачено»/«Отгружено» не выполняется — никаких скрытых фоновых созданий.
    // Чтобы вернуть авто-списание на «Отгружено», раскомментируйте строку autoShipDeal.
    if (newStage !== prevStage) {
      try {
        const st = await env.DB.prepare('SELECT label FROM deal_stages WHERE id=?').bind(newStage).first();
        const label = (st && st.label) || '';
        // if (/отгруж/i.test(label)) await autoShipDeal(env, dealId, auth);
        // Этап сделки → статус связанной отгрузки (только обновление СУЩЕСТВУЮЩИХ, без создания)
        let shipStatus = null;
        if (/достав|закры|выполн|заверш/i.test(label)) shipStatus = 'delivered';
        else if (/отгруж/i.test(label)) shipStatus = 'shipped';
        if (shipStatus) {
          await ensureShipmentStatuses(env);
          await env.DB.prepare('UPDATE shipments SET status_id=? WHERE deal_id=?').bind(shipStatus, dealId).run();
        }
        // Стадия «Резерв»: при попадании на неё — авто-резерв всех позиций + старт срока;
        // при уходе с неё — останавливаем срок (резерв оставляем, снимается вручную/при отгрузке).
        if (/резерв/i.test(label)) {
          try { await reserveDeal(env, dealId, false); } catch (e) {}
          await env.DB.prepare("UPDATE deals SET reserved_at=datetime('now') WHERE id=?").bind(dealId).run();
        } else if (prevStage && await isReserveStage(env, prevStage)) {
          await env.DB.prepare('UPDATE deals SET reserved_at=NULL WHERE id=?').bind(dealId).run();
          await env.DB.prepare("DELETE FROM notifications WHERE ref LIKE ?").bind(`reserveexp:${dealId}:%`).run();
        }
      } catch (e) { /* не блокируем смену этапа */ }
    }
  }
  return getDeal(env, dealId);
}

// Статусы отгрузок: гарантируем наличие planned/shipped/delivered (для синхронизации со сделкой)
let SHIP_STATUS_OK = false;
async function ensureShipmentStatuses(env) {
  if (SHIP_STATUS_OK) return;
  for (const [idv, label, color] of [['planned','Запланирована','#F59E0B'], ['shipped','Отгружена','#06B6D4'], ['transit','В пути','#3B82F6'], ['delivered','Доставлена','#22C55E']]) {
    try { await env.DB.prepare('INSERT OR IGNORE INTO shipment_statuses (id,label,color) VALUES (?,?,?)').bind(idv, label, color).run(); } catch (e) {}
  }
  SHIP_STATUS_OK = true;
}

// Одноразовое удаление ВСЕХ отгрузок (по запросу). Флаг в app_settings, чтобы новые
// отгрузки после очистки сохранялись и не удалялись повторно.
let SHIP_CLEARED_OK = false;
async function ensureShipmentsCleared(env) {
  if (SHIP_CLEARED_OK) return;
  try {
    if (!(await getSetting(env, 'shipments_cleared_v2'))) {
      await env.DB.prepare('DELETE FROM shipments').run();
      await setSetting(env, 'shipments_cleared_v2', '1');
    }
  } catch (e) {}
  SHIP_CLEARED_OK = true;
}

// Одноразовый сброс закупочной цены. Раньше закуп заполнялся из приходов; теперь приходы
// формируют опт/розницу, а закуп берётся ТОЛЬКО из регистра цен 1С. Старые приходные
// значения в price_cost обнуляем один раз, дальше их заполняет регистр (syncSalePrices).
let PRICE_COST_RESET_OK = false;
async function ensurePriceCostReset(env) {
  if (PRICE_COST_RESET_OK) return;
  try {
    if (!(await getSetting(env, 'price_cost_reset_v1'))) {
      await env.DB.prepare('UPDATE products SET price_cost=0').run();
      await setSetting(env, 'price_cost_reset_v1', '1');
    }
  } catch (e) {}
  PRICE_COST_RESET_OK = true;
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
  // список фильтруется/пагинируется на фронте — отдаём всех (раньше лимит 500 терял часть)
  const limit = clampInt(url.searchParams.get('limit'), 100000, 1, 100000);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1e9);
  const manager = url.searchParams.get('manager');
  const where = ['archived_at IS NULL']; // архивные клиенты в обычном списке не показываем
  const args = [];
  if (manager) { where.push('manager_id=?'); args.push(manager); }
  const ws = 'WHERE ' + where.join(' AND ');
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

async function writeClient(env, request, method, id, ctx) {
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

  // Двухсторонний обмен: ставим контрагента в очередь на отправку в 1С (этап 4 — с ретраями).
  const job = tryOnecNow(env, 'client', clientId, ctx);
  if (job && !(ctx && typeof ctx.waitUntil === 'function')) await job;

  return getClient(env, clientId);
}

// CRM → 1С: создание/обновление контрагента в Catalog_Контрагенты.
// Идемпотентно: при наличии ext_ref — PATCH существующего, иначе POST + сохранение Ref_Key.
async function pushClientToOnec(env, clientId) {
  if (!env.ODATA_URL) return; // интеграция не настроена — пропускаем
  const c = await env.DB.prepare('SELECT id, name, bin, ext_ref FROM clients WHERE id=?').bind(clientId).first();
  if (!c || !c.name) return;
  const payload = { Description: String(c.name).slice(0, 150) };
  if (c.bin) payload['ИдентификационныйКодЛичности'] = String(c.bin);
  if (c.ext_ref) {
    await odataWrite(env, 'PATCH', `Catalog_Контрагенты(guid'${c.ext_ref}')`, payload);
  } else {
    const created = await odataWrite(env, 'POST', 'Catalog_Контрагенты', payload);
    const ref = created && created.Ref_Key;
    if (ref) await env.DB.prepare('UPDATE clients SET ext_ref=? WHERE id=?').bind(ref, clientId).run();
  }
}

// CRM → 1С: создание/обновление поставщика (тоже контрагент в Catalog_Контрагенты).
async function pushSupplierToOnec(env, supplierId) {
  if (!env.ODATA_URL) return; // интеграция не настроена — пропускаем
  const s = await env.DB.prepare('SELECT id, name, bin, ext_ref FROM suppliers WHERE id=?').bind(supplierId).first();
  if (!s || !s.name) return;
  const payload = { Description: String(s.name).slice(0, 150) };
  if (s.bin) payload['ИдентификационныйКодЛичности'] = String(s.bin);
  if (s.ext_ref) {
    await odataWrite(env, 'PATCH', `Catalog_Контрагенты(guid'${s.ext_ref}')`, payload);
  } else {
    const created = await odataWrite(env, 'POST', 'Catalog_Контрагенты', payload);
    const ref = created && created.Ref_Key;
    if (ref) await env.DB.prepare('UPDATE suppliers SET ext_ref=? WHERE id=?').bind(ref, supplierId).run();
  }
}

// Сохранение поставщика в CRM + двусторонняя отправка в 1С (с очередью/ретраями).
async function writeSupplier(env, request, method, id, ctx) {
  await ensureSupplierExtRef(env);
  const body = await request.json().catch(() => ({}));
  const supId = id || body.id || genId();
  const cols = (await columns(env, 'suppliers')).map((c) => c.name);
  const data = { ...body, id: supId };
  const keys = Object.keys(data).filter((k) => cols.includes(k));
  if (method === 'POST') {
    await env.DB.prepare(`INSERT INTO suppliers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((k) => data[k])).run();
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) await env.DB.prepare(`UPDATE suppliers SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`).bind(...up.map((k) => data[k]), supId).run();
  }
  const job = tryOnecNow(env, 'supplier', supId, ctx);
  if (job && !(ctx && typeof ctx.waitUntil === 'function')) await job;
  const row = await env.DB.prepare('SELECT * FROM suppliers WHERE id=?').bind(supId).first();
  return json(row, method === 'POST' ? 201 : 200);
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
// CRM → 1С (этап 2): счёт CRM -> черновик «Счёт на оплату покупателю» в 1С.
//
// Документ создаётся НЕПРОВЕДЁННЫМ (Posted=false) — это безопасный черновик:
// он не двигает склад и взаиморасчёты, его всегда можно проверить/удалить в 1С.
//
// Реквизиты НЕ хардкодим по GUID — организацию и валюту находим в самой базе 1С
// по названию и кэшируем в onec_refs. Договор у каждого контрагента свой, поэтому
// для клиента находим/создаём «Основной договор» (вид: с покупателем, валюта: тенге).
//
// Имена сущностей/полей 1С зависят от конфигурации — собраны здесь, чтобы при
// расхождении поправить в одном месте. Любая ошибка обмена пишется в sync_state
// (entity='invoices_push'), её видно в статусе синхронизации.
// --------------------------------------------------------------------------
const ONEC_ORG_NAME = 'KazEnergoSnab';                  // ищем по вхождению в название организации
const ONEC_DOC = 'Document_СчетНаОплатуПокупателю';     // документ-счёт в 1С
const ONEC_DOC_ROWS = 'Товары';                         // имя табличной части в теле документа

let INVOICE_EXTREF_OK = false;
async function ensureInvoiceExtRef(env) {
  if (INVOICE_EXTREF_OK) return;
  try { await env.DB.prepare('ALTER TABLE invoices ADD COLUMN ext_ref TEXT').run(); } catch (e) {}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS onec_refs (
    kind TEXT, key TEXT NOT NULL DEFAULT '', ref TEXT, PRIMARY KEY (kind, key)
  )`).run();
  INVOICE_EXTREF_OK = true;
}

// Статус оплаты счетов из 1С → CRM (Вариант A). «Счёт на оплату» в Бухгалтерии не хранит
// факт оплаты — берём ПЛАТЕЖИ (банк ПоступлениеНаРасчетныйСчет + касса ПриходныйКассовыйОрдер),
// суммируем по контрагенту и гасим его счета по дате (FIFO). Имена полей определяем по образцу.
// В 1С ничего не пишем. Сопоставление CRM↔1С по invoices.ext_ref.
async function syncInvoicePayments(env) {
  await ensureInvoiceExtRef(env);
  await ensureArchiveColumns(env);
  const logState = async (msg) => { try { await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('invoice_payments_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`).bind(String(msg).slice(0, 300)).run(); } catch (e) {} };

  const inv = await env.DB.prepare("SELECT id, ext_ref, due, status_id, deal_id FROM invoices WHERE ext_ref IS NOT NULL AND ext_ref<>'' AND (archived_at IS NULL OR archived_at='')").all();
  const crm = {}; for (const r of (inv.results || [])) crm[r.ext_ref] = r;
  if (!Object.keys(crm).length) { await logState('счетов с привязкой к 1С нет'); return json({ ok: true, invoices: 0 }); }

  const fieldsOf = async (e) => { try { const d = await odataGet(env, `${e}?$format=json&$top=1`); const s = (d.value || [])[0]; return s ? Object.keys(s) : null; } catch (_) { return null; } };
  const pick = (keys, ...res) => { for (const re of res) { const k = keys && keys.find(x => re.test(x)); if (k) return k; } return null; };

  // 1) все счета 1С: Ref_Key, дата, контрагент, сумма
  const bk = await fieldsOf(ONEC_DOC);
  const bParty = pick(bk, /^контрагент_key$/i, /контрагент.*_key$/i, /покупател.*_key$/i);
  const bSum = pick(bk, /^суммадокумента$/i, /суммадокумент/i, /^сумма$/i);
  if (!bk || !bParty || !bSum) { await logState('в счёте нет контрагента/суммы; поля: ' + ((bk || []).join(', ') || '—')); return json({ ok: false, keys: bk }); }
  const bills = [], billRefs = new Set();
  { let skip = 0; const sel = ['Ref_Key', 'Date', bParty, bSum].join(',');
    while (true) {
      const d = await odataGet(env, `${ONEC_DOC}?$format=json&$select=${sel}&$top=5000&$skip=${skip}`);
      const list = d.value || [];
      for (const r of list) { bills.push({ ref: r.Ref_Key, date: String(r.Date || ''), party: r[bParty] || '', amount: Number(r[bSum]) || 0 }); billRefs.add(r.Ref_Key); }
      if (list.length < 5000) break; skip += 5000;
    } }

  // 2) платежи (банк + касса) → сумма по контрагенту (только оплата от покупателя, если поле есть)
  const paidByParty = {}, payInfo = [];
  for (const doc of ['Document_ПоступлениеНаРасчетныйСчет', 'Document_ПриходныйКассовыйОрдер']) {
    const pk = await fieldsOf(doc);
    const pParty = pick(pk, /^контрагент_key$/i, /контрагент.*_key$/i, /плательщик.*_key$/i, /покупател.*_key$/i);
    const pSum = pick(pk, /^суммадокумента$/i, /суммадокумент/i, /^сумма$/i);
    const pOp = pick(pk, /видоперации/i);
    if (!pk || !pParty || !pSum) { payInfo.push(doc.split('_').pop() + ':н/д'); continue; }
    let n = 0, sk = 0; const sel = ['Ref_Key', pParty, pSum].concat(pOp ? [pOp] : []).join(',');
    while (true) {
      const d = await odataGet(env, `${doc}?$format=json&$select=${sel}&$top=5000&$skip=${sk}`);
      const list = d.value || [];
      for (const r of list) {
        if (pOp && typeof r[pOp] === 'string' && r[pOp] && !/покупател|оплат/i.test(r[pOp])) continue;
        const amt = Number(r[pSum]) || 0; if (amt <= 0) continue;
        const p = r[pParty] || ''; paidByParty[p] = (paidByParty[p] || 0) + amt; n++;
      }
      if (list.length < 5000) break; sk += 5000;
    }
    payInfo.push(doc.split('_').pop() + ':' + n);
  }

  // 3) FIFO по контрагенту: гасим счета по дате, пока хватает оплат
  const byParty = {}; for (const b of bills) (byParty[b.party] || (byParty[b.party] = [])).push(b);
  const paidRefs = new Set();
  for (const p in byParty) {
    const arr = byParty[p].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let avail = paidByParty[p] || 0, run = 0;
    for (const b of arr) { run += b.amount; if (run <= avail + 0.5) paidRefs.add(b.ref); }
  }

  // 4) обновляем CRM-счета: paid / overdue (по сроку) / pending
  const today = new Date().toISOString().slice(0, 10);
  const stmts = []; let setPaid = 0, setOverdue = 0, setPending = 0, miss = 0;
  const paidDeals = new Set(); // сделки, чей счёт только что стал оплачен — проверим на авто-отгрузку
  for (const ref in crm) {
    const r = crm[ref];
    if (!billRefs.has(ref)) { miss++; continue; }
    let st;
    if (paidRefs.has(ref)) { st = 'paid'; setPaid++; }
    else if (r.due && String(r.due).slice(0, 10) < today) { st = 'overdue'; setOverdue++; }
    else { st = 'pending'; setPending++; }
    if (st !== r.status_id) {
      stmts.push(env.DB.prepare('UPDATE invoices SET status_id=? WHERE id=?').bind(st, r.id));
      if (st === 'paid' && r.deal_id) paidDeals.add(r.deal_id);
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  // «Отгрузка появляется, когда клиент полностью оплатил» — по сделкам со свежей оплатой
  let autoShip = 0;
  for (const did of paidDeals) { try { if (await ensureShipmentForPaidDeal(env, did)) autoShip++; } catch (e) {} }
  await logState(`вариант A (по контрагенту): счетов 1С ${bills.length}, платежи [${payInfo.join(', ') || '—'}]; наших ${Object.keys(crm).length}: оплачено ${setPaid}, просрочено ${setOverdue}, ожидает ${setPending}, не в 1С ${miss}${autoShip ? `; отгрузок создано ${autoShip}` : ''}`);
  return json({ bills: bills.length, payInfo, paid: setPaid, overdue: setOverdue, pending: setPending, missing: miss, autoShip });
}

async function onecRefGet(env, kind, key = '') {
  const r = await env.DB.prepare('SELECT ref FROM onec_refs WHERE kind=? AND key=?').bind(kind, key).first();
  return (r && r.ref) || null;
}
async function onecRefSet(env, kind, key, ref) {
  await env.DB.prepare(`INSERT INTO onec_refs (kind, key, ref) VALUES (?,?,?)
    ON CONFLICT(kind, key) DO UPDATE SET ref=excluded.ref`).bind(kind, key, ref).run();
}

// Дата для 1С (OData ждёт ISO без таймзоны: '2026-06-14T00:00:00').
function onecDate(d) {
  const s = String(d || '').trim();
  if (!s) return new Date().toISOString().slice(0, 19);
  return s.length <= 10 ? `${s}T00:00:00` : s.slice(0, 19);
}

// Организация ТОО «KazEnergoSnab»: организаций в базе мало — берём все и ищем по вхождению.
async function resolveOnecOrg(env) {
  const cached = await onecRefGet(env, 'org');
  if (cached) return cached;
  const data = await odataGet(env, 'Catalog_Организации?$format=json&$select=Ref_Key,Description,DeletionMark');
  const rows = (data.value || []).filter((r) => !r.DeletionMark);
  const want = ONEC_ORG_NAME.toLowerCase();
  const hit = rows.find((r) => String(r.Description || '').toLowerCase().includes(want));
  if (!hit) throw new Error(`организация «${ONEC_ORG_NAME}» не найдена в 1С`);
  await onecRefSet(env, 'org', '', hit.Ref_Key);
  return hit.Ref_Key;
}

// Валюта «тенге»: по коду (KZT/398) или по названию.
async function resolveOnecCurrency(env) {
  const cached = await onecRefGet(env, 'currency');
  if (cached) return cached;
  const data = await odataGet(env, 'Catalog_Валюты?$format=json&$select=Ref_Key,Code,Description,DeletionMark');
  const rows = (data.value || []).filter((r) => !r.DeletionMark);
  const byCode = rows.find((r) => ['KZT', '398', 'ТГ', 'ТНГ'].includes(String(r.Code || '').trim().toUpperCase()));
  const byName = rows.find((r) => /тенге|kzt/i.test(String(r.Description || '')));
  const hit = byCode || byName;
  if (!hit) throw new Error('валюта «тенге» (KZT) не найдена в 1С');
  await onecRefSet(env, 'currency', '', hit.Ref_Key);
  return hit.Ref_Key;
}

// «Основной договор» контрагента: находим существующий или создаём (вид — с покупателем).
// Договор подчинён контрагенту, поэтому общего на всех быть не может — кэшируем по клиенту.
async function resolveOnecContract(env, clientRef, orgRef, currencyRef) {
  const cached = await onecRefGet(env, 'contract', clientRef);
  if (cached) return cached;
  let ref = null;
  try {
    const path = `Catalog_ДоговорыКонтрагентов?$format=json&$select=Ref_Key,Description,DeletionMark`
      + `&$filter=Owner_Key eq guid'${clientRef}'`;
    const data = await odataGet(env, path);
    const rows = (data.value || []).filter((r) => !r.DeletionMark);
    const hit = rows.find((r) => /основн/i.test(String(r.Description || '')));
    if (hit) ref = hit.Ref_Key;
  } catch (e) { /* фильтрация по владельцу не поддержалась — просто создадим договор ниже */ }
  if (!ref) {
    const created = await odataWrite(env, 'POST', 'Catalog_ДоговорыКонтрагентов', {
      Description: 'Основной договор',
      Owner_Key: clientRef,
      Owner_Type: 'StandardODATA.Catalog_Контрагенты',
      'Организация_Key': orgRef,
      'ВидДоговора': 'СПокупателем',
      'ВалютаВзаиморасчетов_Key': currencyRef,
    });
    ref = created && created.Ref_Key;
  }
  if (!ref) throw new Error('не удалось получить/создать договор контрагента');
  await onecRefSet(env, 'contract', clientRef, ref);
  return ref;
}

// Основная отправка: строит и пишет документ-счёт. Идемпотентно по invoices.ext_ref.
async function pushInvoiceToOnec(env, invoiceId) {
  if (!env.ODATA_URL) return null; // интеграция не настроена
  await ensureInvoiceExtRef(env);
  const iv = await env.DB.prepare('SELECT id, no, client_id, deal_id, date, amount, ext_ref FROM invoices WHERE id=?').bind(invoiceId).first();
  if (!iv || !iv.client_id) return null;

  // контрагент обязан существовать в 1С — если ещё не выгружен, выгружаем сейчас
  let cl = await env.DB.prepare('SELECT id, name, ext_ref FROM clients WHERE id=?').bind(iv.client_id).first();
  if (cl && !cl.ext_ref) {
    await pushClientToOnec(env, cl.id);
    cl = await env.DB.prepare('SELECT id, name, ext_ref FROM clients WHERE id=?').bind(iv.client_id).first();
  }
  if (!cl || !cl.ext_ref) throw new Error('клиент не связан с 1С (контрагент не создан)');

  const orgRef = await resolveOnecOrg(env);
  const curRef = await resolveOnecCurrency(env);
  const dogRef = await resolveOnecContract(env, cl.ext_ref, orgRef, curRef);

  // позиции документа берём из связанной сделки (товары с привязкой к 1С)
  const lines = [];
  if (iv.deal_id) {
    const items = await env.DB.prepare(
      `SELECT di.qty, di.price_used, p.ext_ref FROM deal_items di
       JOIN products p ON p.id = di.product_id
       WHERE di.deal_id = ? AND p.ext_ref IS NOT NULL`
    ).bind(iv.deal_id).all();
    let n = 0;
    for (const it of items.results) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price_used) || 0;
      lines.push({ LineNumber: String(++n), 'Номенклатура_Key': it.ext_ref, 'Количество': qty, 'Цена': price, 'Сумма': qty * price });
    }
  }

  const doc = {
    Date: onecDate(iv.date),
    Posted: false, // черновик — не проводим
    'Организация_Key': orgRef,
    'Контрагент_Key': cl.ext_ref,
    'ДоговорКонтрагента_Key': dogRef,
    'ВалютаДокумента_Key': curRef,
    'СуммаДокумента': Number(iv.amount) || 0,
    'Комментарий': 'Из CRM' + (iv.no ? ` • счёт ${iv.no}` : ''),
  };
  if (lines.length) doc[ONEC_DOC_ROWS] = lines;

  let ref = iv.ext_ref;
  if (ref) {
    await odataWrite(env, 'PATCH', `${ONEC_DOC}(guid'${ref}')`, doc);
  } else {
    const created = await odataWrite(env, 'POST', ONEC_DOC, doc);
    ref = created && created.Ref_Key;
    if (ref) await env.DB.prepare('UPDATE invoices SET ext_ref=? WHERE id=?').bind(ref, invoiceId).run();
  }
  return ref;
}

// Обёртка с записью результата в статус синхронизации (видно в разделе синхронизации с 1С).
// Уникальный номер документа присваивает сервер: фронт нумерует по длине списка
// (без архивных), а в БД номера архивных документов остаются занятыми из-за
// UNIQUE(no) → коллизии. Берём предложенный номер, если он свободен, иначе
// инкрементируем хвостовое число до свободного. table — из фикс. списка (не польз. ввод).
function splitDocNo(no) {
  const m = String(no || '').match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10), width: m[2].length, suffix: m[3] };
}
async function uniqueDocNo(env, table, preferred, fallbackPrefix) {
  const all = await env.DB.prepare(`SELECT no FROM ${table}`).all();
  const used = new Set((all.results || []).map((r) => String(r.no)));
  if (preferred && !used.has(String(preferred))) return preferred;
  const base = splitDocNo(preferred) || { prefix: fallbackPrefix, num: 0, width: 4, suffix: '' };
  for (let i = 1; i <= 100000; i++) {
    const cand = base.prefix + String(base.num + i).padStart(base.width, '0') + base.suffix;
    if (!used.has(cand)) return cand;
  }
  return base.prefix + Date.now(); // крайний случай — гарантированно уникально
}

// Сохранение счёта в CRM + фоновая отправка черновика в 1С (не задерживает ответ).
async function writeInvoice(env, request, method, id, ctx) {
  const body = await request.json().catch(() => ({}));
  await ensureArchiveColumns(env);
  await ensureInvoiceExtRef(env);
  const invId = id || body.id || genId();
  if (method === 'POST') body.no = await uniqueDocNo(env, 'invoices', body.no, `Сч-${new Date().getFullYear()}-`);
  const cols = (await columns(env, 'invoices')).map((c) => c.name);
  const data = { ...body, id: invId };
  const keys = Object.keys(data).filter((k) => cols.includes(k));

  if (method === 'POST') {
    await env.DB.prepare(`INSERT INTO invoices (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .bind(...keys.map((k) => data[k])).run();
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) {
      await env.DB.prepare(`UPDATE invoices SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`)
        .bind(...up.map((k) => data[k]), invId).run();
    }
  }

  const job = tryOnecNow(env, 'invoice', invId, ctx);
  if (job && !(ctx && typeof ctx.waitUntil === 'function')) await job;

  const row = await env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(invId).first();
  // «Отгрузка появляется, когда клиент полностью оплатил»
  if (row && row.status_id === 'paid' && row.deal_id) { try { await ensureShipmentForPaidDeal(env, row.deal_id); } catch (e) {} }
  return json(row, method === 'POST' ? 201 : 200);
}

// Создаёт черновик отгрузки (статус planned), когда сделка ПОЛНОСТЬЮ оплачена (все её счета
// оплачены) и отгрузки ещё нет. Идемпотентно. Управляется тумблером auto_shipment_on_paid
// (по умолчанию включено). Уведомляет кладовщиков/директора — «к сборке».
async function ensureShipmentForPaidDeal(env, dealId) {
  if (!dealId) return;
  if ((await getSetting(env, 'auto_shipment_on_paid')) === '0') return; // тумблер выключен
  await ensureArchiveColumns(env);
  await ensureShipmentExtRef(env);
  const exists = await env.DB.prepare('SELECT id FROM shipments WHERE deal_id=?').bind(dealId).first();
  if (exists) return; // отгрузка уже есть
  // все ли счета сделки оплачены (и есть хотя бы один)?
  const inv = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status_id='paid' THEN 1 ELSE 0 END) AS paid FROM invoices WHERE deal_id=? AND (archived_at IS NULL OR archived_at='')"
  ).bind(dealId).first();
  if (!inv || !inv.total || (inv.paid || 0) < inv.total) return; // оплачены не все счета
  const d = await env.DB.prepare('SELECT d.id, d.client_id, d.no AS dno, c.address AS caddr FROM deals d LEFT JOIN clients c ON c.id=d.client_id WHERE d.id=?').bind(dealId).first();
  if (!d) return;
  let addr = d.caddr || '';
  try { const da = await env.DB.prepare('SELECT address FROM deals WHERE id=?').bind(dealId).first(); if (da && da.address) addr = da.address; } catch (e) {}
  const it = await env.DB.prepare('SELECT COUNT(*) AS n FROM deal_items WHERE deal_id=?').bind(dealId).first();
  const no = await uniqueDocNo(env, 'shipments', null, 'ТТН-');
  const id = genId();
  await env.DB.prepare(
    'INSERT INTO shipments (id, no, deal_id, client_id, date, items, weight, transport, driver, status_id, destination) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, no, dealId, d.client_id, new Date().toISOString().slice(0, 10), (it && it.n) || 0, 0, '', '', 'planned', addr).run();
  try {
    await ensureNotifSchema(env);
    const us = await env.DB.prepare("SELECT id FROM users WHERE role_key IN ('warehouse','director') AND active=1").all();
    const txt = `Сделка оплачена — создана отгрузка ${no}${d.dno ? ' по сделке ' + d.dno : ''}. К сборке.`;
    const stmts = [];
    for (const u of (us.results || [])) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (text, type, read, created_at, user_id, ref) VALUES (?, 'info', 0, datetime('now'), ?, ?)").bind(txt, u.id, `shipcreated:${id}:${u.id}`));
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  } catch (e) {}
  return id;
}

// --------------------------------------------------------------------------
// CRM → 1С (этап 3): отгрузка CRM -> ЧЕРНОВИК «Реализация товаров и услуг».
//
// ⚠ Влияет на налоги/ЭСФ. ВЫКЛЮЧЕН по умолчанию: срабатывает только при секрете
// ONEC_SHIPMENTS=1 или включённом тумблере в CRM (Настройки → Синхронизация,
// директор). Включать после этапа 2 и согласования с бухгалтером.
//
// Документ создаётся НЕПРОВЕДЁННЫМ (без Post): 1С требует «% НДС» в строках,
// которого в CRM нет, поэтому НДС, проведение и списание склада выполняет
// бухгалтер вручную в 1С. Реквизиты резолвятся по названию + склад «по умолчанию».
// --------------------------------------------------------------------------
const ONEC_SHIP_DOC = 'Document_РеализацияТоваровУслуг'; // документ реализации в 1С

// Простое key/value хранилище настроек (создаётся на лету).
async function ensureAppSettings(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)').run();
}
async function getSetting(env, key) {
  await ensureAppSettings(env);
  const r = await env.DB.prepare('SELECT value FROM app_settings WHERE key=?').bind(key).first();
  return r ? r.value : null;
}
async function setSetting(env, key, value) {
  await ensureAppSettings(env);
  await env.DB.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, String(value)).run();
}

// Принудительное включение через переменную окружения (приоритет над настройкой в БД).
function onecShipmentsEnvForced(env) {
  return /^(1|on|true|yes|да)$/i.test(String(env.ONEC_SHIPMENTS || '').trim());
}
// Этап 3 включён, если задана переменная окружения ИЛИ переключатель в CRM (директор).
async function isShipmentsPushEnabled(env) {
  if (onecShipmentsEnvForced(env)) return true;
  return /^(1|on|true|yes)$/i.test(String(await getSetting(env, 'onec_shipments') || '').trim());
}

let SHIP_EXTREF_OK = false;
async function ensureShipmentExtRef(env) {
  if (SHIP_EXTREF_OK) return;
  for (const ddl of [
    'ALTER TABLE shipments ADD COLUMN ext_ref TEXT',
    'ALTER TABLE shipments ADD COLUMN delivery_photo TEXT', // фото-подтверждение доставки (URL в R2; первое фото)
    'ALTER TABLE shipments ADD COLUMN delivery_photos TEXT', // несколько фото доставки (JSON-массив URL в R2)
    'ALTER TABLE shipments ADD COLUMN delivered_at TEXT',
    'ALTER TABLE shipments ADD COLUMN delivered_by TEXT',   // user_id водителя
  ]) { try { await env.DB.prepare(ddl).run(); } catch (e) {} }
  SHIP_EXTREF_OK = true;
}

// Склад «по умолчанию»: предпочитаем основной/по-умолчанию, иначе предопределённый, иначе первый.
async function resolveOnecWarehouse(env) {
  await ensureInvoiceExtRef(env); // гарантирует таблицу onec_refs
  const cached = await onecRefGet(env, 'warehouse');
  if (cached) return cached;
  const data = await odataGet(env, 'Catalog_Склады?$format=json&$select=Ref_Key,Description,DeletionMark,Predefined');
  const rows = (data.value || []).filter((r) => !r.DeletionMark);
  const byName = rows.find((r) => /основн|умолчан/i.test(String(r.Description || '')));
  const predef = rows.find((r) => r.Predefined);
  const hit = byName || predef || rows[0];
  if (!hit) throw new Error('склад не найден в 1С');
  await onecRefSet(env, 'warehouse', '', hit.Ref_Key);
  return hit.Ref_Key;
}

// Основная отправка реализации. Идемпотентно по shipments.ext_ref.
async function pushShipmentToOnec(env, shipmentId) {
  if (!env.ODATA_URL) return null;
  await ensureInvoiceExtRef(env);
  await ensureShipmentExtRef(env);
  const sh = await env.DB.prepare('SELECT id, no, client_id, deal_id, date, ext_ref FROM shipments WHERE id=?').bind(shipmentId).first();
  if (!sh || !sh.client_id) return null;

  let cl = await env.DB.prepare('SELECT id, name, ext_ref FROM clients WHERE id=?').bind(sh.client_id).first();
  if (cl && !cl.ext_ref) {
    await pushClientToOnec(env, cl.id);
    cl = await env.DB.prepare('SELECT id, name, ext_ref FROM clients WHERE id=?').bind(sh.client_id).first();
  }
  if (!cl || !cl.ext_ref) throw new Error('клиент не связан с 1С (контрагент не создан)');

  const orgRef = await resolveOnecOrg(env);
  const curRef = await resolveOnecCurrency(env);
  const dogRef = await resolveOnecContract(env, cl.ext_ref, orgRef, curRef);
  const whRef = await resolveOnecWarehouse(env);

  // позиции и сумма — из связанной сделки (товары с привязкой к 1С)
  const lines = [];
  let sum = 0;
  if (sh.deal_id) {
    const items = await env.DB.prepare(
      `SELECT di.qty, di.price_used, p.ext_ref FROM deal_items di
       JOIN products p ON p.id = di.product_id
       WHERE di.deal_id = ? AND p.ext_ref IS NOT NULL`
    ).bind(sh.deal_id).all();
    let n = 0;
    for (const it of items.results) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price_used) || 0;
      lines.push({ LineNumber: String(++n), 'Номенклатура_Key': it.ext_ref, 'Количество': qty, 'Цена': price, 'Сумма': qty * price });
      sum += qty * price;
    }
    if (!sum) {
      const deal = await env.DB.prepare('SELECT amount FROM deals WHERE id=?').bind(sh.deal_id).first();
      sum = (deal && Number(deal.amount)) || 0;
    }
  }

  const doc = {
    Date: onecDate(sh.date),
    Posted: false, // черновик — проведение делает бухгалтер вручную в 1С
    'Организация_Key': orgRef,
    'Контрагент_Key': cl.ext_ref,
    'ДоговорКонтрагента_Key': dogRef,
    'Склад_Key': whRef,
    'ВалютаДокумента_Key': curRef,
    'СуммаДокумента': sum,
    'Комментарий': 'Из CRM' + (sh.no ? ` • отгрузка ${sh.no}` : ''),
  };
  if (lines.length) doc['Товары'] = lines;

  let ref = sh.ext_ref;
  if (ref) {
    await odataWrite(env, 'PATCH', `${ONEC_SHIP_DOC}(guid'${ref}')`, doc);
  } else {
    const created = await odataWrite(env, 'POST', ONEC_SHIP_DOC, doc);
    ref = created && created.Ref_Key;
    if (ref) await env.DB.prepare('UPDATE shipments SET ext_ref=? WHERE id=?').bind(ref, shipmentId).run();
  }
  if (!ref) throw new Error('1С не вернула ссылку на документ реализации');

  // По решению пользователя документ создаётся ЧЕРНОВИКОМ без авто-проведения:
  // 1С требует «% НДС» в строках, а в CRM ставки нет — поэтому НДС и проведение
  // (а значит и списание склада) выполняет бухгалтер вручную в 1С.
  return { ref, posted: false, lines: lines.length };
}

// Сохранение отгрузки в CRM + (если включено) фоновая отправка черновика в 1С.
async function writeShipment(env, request, method, id, ctx) {
  const body = await request.json().catch(() => ({}));
  await ensureShipmentExtRef(env);
  const shId = id || body.id || genId();
  if (String(body.status_id) === 'delivered' && !body.delivered_at) body.delivered_at = new Date().toISOString();
  if (method === 'POST') body.no = await uniqueDocNo(env, 'shipments', body.no, 'ТТН-');
  const cols = (await columns(env, 'shipments')).map((c) => c.name);
  const data = { ...body, id: shId };
  const keys = Object.keys(data).filter((k) => cols.includes(k));

  if (method === 'POST') {
    await env.DB.prepare(`INSERT INTO shipments (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .bind(...keys.map((k) => data[k])).run();
  } else {
    const up = keys.filter((k) => k !== 'id');
    if (up.length) {
      await env.DB.prepare(`UPDATE shipments SET ${up.map((k) => `${k}=?`).join(',')} WHERE id=?`)
        .bind(...up.map((k) => data[k]), shId).run();
    }
  }

  // Уведомление бухгалтеру (кто оплачивает доставку) и директору при отметке «Доставлено»
  // (в т.ч. при загрузке фото-подтверждения). ref делает его идемпотентным.
  if (String(body.status_id) === 'delivered') {
    try {
      await ensureNotifSchema(env);
      const sh = await env.DB.prepare('SELECT s.no AS no, s.delivery_photo AS photo, c.name AS client_name FROM shipments s LEFT JOIN clients c ON c.id=s.client_id WHERE s.id=?').bind(shId).first();
      const accs = await env.DB.prepare("SELECT id FROM users WHERE role_key IN ('accountant','director') AND active=1").all();
      const withPhoto = (sh && sh.photo) ? ' (фото загружено)' : '';
      const txt = `Доставка выполнена${withPhoto}: ${sh && sh.no ? sh.no : 'отгрузка'}${sh && sh.client_name ? ' — ' + sh.client_name : ''}. Оплата доставки.`;
      const stmts = [];
      for (const u of (accs.results || [])) {
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (text, type, read, created_at, user_id, ref) VALUES (?, 'info', 0, datetime('now'), ?, ?)").bind(txt, u.id, `delivered:${shId}:${u.id}`));
      }
      for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    } catch (e) {}
  }

  if (await isShipmentsPushEnabled(env)) {
    const job = tryOnecNow(env, 'shipment', shId, ctx);
    if (job && !(ctx && typeof ctx.waitUntil === 'function')) await job;
  }

  const row = await env.DB.prepare('SELECT * FROM shipments WHERE id=?').bind(shId).first();
  return json(row, method === 'POST' ? 201 : 200);
}

// --------------------------------------------------------------------------
// CRM → 1С (этап 4): очередь, ретраи и лог.
//
// Каждая отправка (контрагент/счёт/отгрузка) ставится в очередь onec_queue и
// сразу пробуется в фоне. Если 1С недоступна или вернула ошибку — задача остаётся
// в очереди и до-сылается по расписанию (cron /api/sync/run, каждые ~10 мин) с
// нарастающей паузой (backoff). Каждая попытка пишется в onec_log.
// --------------------------------------------------------------------------
const ONEC_MAX_ATTEMPTS = 12;                        // после стольких неудач — статус 'error' (стоп)
const ONEC_BACKOFF_MIN = [1, 2, 5, 10, 20, 30, 60];  // паузы между попытками, мин (далее 60)
const ONEC_KIND_RU = { client: 'контрагент', supplier: 'поставщик', invoice: 'счёт', shipment: 'отгрузка' };

let ONEC_QUEUE_OK = false;
async function ensureOnecQueue(env) {
  if (ONEC_QUEUE_OK) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS onec_queue (
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, ref_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS onec_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT, ref_id TEXT, ok INTEGER, info TEXT
    )`),
  ]);
  ONEC_QUEUE_OK = true;
}

async function onecLog(env, kind, refId, ok, info) {
  try {
    await env.DB.prepare('INSERT INTO onec_log (kind, ref_id, ok, info) VALUES (?,?,?,?)')
      .bind(kind, refId, ok ? 1 : 0, String(info || '').slice(0, 400)).run();
    // подрезаем лог, чтобы не рос бесконечно (оставляем ~последние 500 записей)
    await env.DB.prepare('DELETE FROM onec_log WHERE id < (SELECT MAX(id) - 500 FROM onec_log)').run();
  } catch (e) {}
}

// Поставить задачу в очередь (или «оживить» существующую для немедленной попытки).
async function enqueueOnec(env, kind, refId) {
  await ensureOnecQueue(env);
  await env.DB.prepare(
    `INSERT INTO onec_queue (kind, ref_id, status, attempts, next_at, updated_at)
     VALUES (?,?,'pending',0,datetime('now'),datetime('now'))
     ON CONFLICT(kind, ref_id) DO UPDATE SET status='pending', next_at=datetime('now'), updated_at=datetime('now')`
  ).bind(kind, refId).run();
}

// Выполнить саму отправку по типу. Бросает исключение при ошибке.
async function runOnecPush(env, kind, refId) {
  if (kind === 'client') { await pushClientToOnec(env, refId); return 'контрагент отправлен'; }
  if (kind === 'supplier') { await pushSupplierToOnec(env, refId); return 'поставщик отправлен'; }
  if (kind === 'invoice') { const ref = await pushInvoiceToOnec(env, refId); return `→ 1С${ref ? ` (${ref})` : ''}`; }
  if (kind === 'shipment') {
    if (!(await isShipmentsPushEnabled(env))) return 'этап 3 выключен — пропуск';
    const r = await pushShipmentToOnec(env, refId);
    return (r && r.ref) ? `черновик «Реализация» создан в 1С (позиций ${r.lines})` : 'нет данных';
  }
  throw new Error('неизвестный тип задачи: ' + kind);
}

// Обновить «последний результат» в sync_state для карточки синхронизации.
async function onecStatusLine(env, kind, info) {
  const entity = kind === 'invoice' ? 'invoices_push' : kind === 'shipment' ? 'shipments_push' : 'clients_push';
  try {
    await env.DB.prepare(
      `INSERT INTO sync_state (entity, last_at, info) VALUES (?, datetime('now'), ?)
       ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
    ).bind(entity, String(info).slice(0, 300)).run();
  } catch (e) {}
}

// Одна попытка по задаче: успех -> done (выходит из очереди), ошибка -> backoff либо стоп.
async function attemptOnec(env, kind, refId) {
  await ensureOnecQueue(env);
  const cur = await env.DB.prepare('SELECT attempts FROM onec_queue WHERE kind=? AND ref_id=?').bind(kind, refId).first();
  const attempts = cur ? Number(cur.attempts) : 0;
  const ru = ONEC_KIND_RU[kind] || kind;
  try {
    const res = await runOnecPush(env, kind, refId);
    await env.DB.prepare(`UPDATE onec_queue SET status='done', attempts=attempts+1, last_error=NULL, updated_at=datetime('now') WHERE kind=? AND ref_id=?`).bind(kind, refId).run();
    await onecLog(env, kind, refId, true, res);
    await onecStatusLine(env, kind, `ok: ${ru} ${refId} — ${res}`);
    return true;
  } catch (e) {
    const msg = ((e && e.message) || String(e)).slice(0, 400);
    const n = attempts + 1;
    const stop = n >= ONEC_MAX_ATTEMPTS;
    const waitMin = ONEC_BACKOFF_MIN[Math.min(n, ONEC_BACKOFF_MIN.length - 1)];
    await env.DB.prepare(
      `UPDATE onec_queue SET status=?, attempts=?, last_error=?, next_at=datetime('now', ?), updated_at=datetime('now') WHERE kind=? AND ref_id=?`
    ).bind(stop ? 'error' : 'pending', n, msg, `+${waitMin} minutes`, kind, refId).run();
    await onecLog(env, kind, refId, false, `попытка ${n}${stop ? ' (стоп)' : `, повтор через ${waitMin} мин`}: ${msg}`);
    await onecStatusLine(env, kind, `ошибка (попытка ${n}${stop ? ', остановлено' : `, повтор через ${waitMin} мин`}): ${ru} ${refId} — ${msg}`);
    return false;
  }
}

// Поставить в очередь и сразу попробовать в фоне (вызывается из обработчиков сохранения).
function tryOnecNow(env, kind, refId, ctx) {
  if (!env.ODATA_URL) return null;
  const job = (async () => { await enqueueOnec(env, kind, refId); await attemptOnec(env, kind, refId); })().catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  return job;
}

// Обработать «созревшие» задачи очереди (вызывается из cron runDueSyncs и по кнопке).
// force=true (ручной «Досыл сейчас») игнорирует паузу backoff и берёт также задачи
// в статусе error — чтобы можно было сразу повторить и увидеть актуальную ошибку.
async function processOnecQueue(env, limit = 25, force = false) {
  if (!env.ODATA_URL) return { processed: 0, ok: 0, fail: 0 };
  await ensureOnecQueue(env);
  const sql = force
    ? `SELECT kind, ref_id FROM onec_queue WHERE status IN ('pending','error') ORDER BY updated_at LIMIT ?`
    : `SELECT kind, ref_id FROM onec_queue WHERE status='pending' AND (next_at IS NULL OR next_at <= datetime('now')) ORDER BY next_at LIMIT ?`;
  const dueRows = await env.DB.prepare(sql).bind(limit).all();
  let ok = 0, fail = 0;
  for (const r of (dueRows.results || [])) {
    if (await attemptOnec(env, r.kind, r.ref_id)) ok++; else fail++;
  }
  return { processed: ok + fail, ok, fail };
}

// Сводка очереди + последние записи лога (для раздела синхронизации).
async function onecQueueStatus(env) {
  await ensureOnecQueue(env);
  const counts = await env.DB.prepare(`SELECT status, COUNT(*) AS c FROM onec_queue GROUP BY status`).all();
  const summary = { pending: 0, error: 0, done: 0 };
  for (const r of (counts.results || [])) summary[r.status] = r.c;
  const log = await env.DB.prepare(`SELECT at, kind, ref_id, ok, info FROM onec_log ORDER BY id DESC LIMIT 30`).all();
  const items = await env.DB.prepare(
    `SELECT kind, ref_id, attempts, next_at, last_error FROM onec_queue WHERE status IN ('pending','error') ORDER BY updated_at DESC LIMIT 30`
  ).all();
  return json({ summary, log: log.results || [], items: items.results || [] });
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
// Извлекает человекочитаемое сообщение об ошибке из тела ответа 1С (OData error JSON или HTML).
function onecErrText(txt) {
  if (!txt) return '';
  try {
    const j = JSON.parse(txt);
    const m = (j['odata.error'] && j['odata.error'].message) || j.message;
    if (m) return String(m.value || m).slice(0, 220);
  } catch (e) {}
  return String(txt).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

async function odataGet(env, path) {
  if (!env.ODATA_URL) throw new Error('ODATA_URL не задан (секрет)');
  const url = encodeURI(env.ODATA_URL.replace(/\/+$/, '') + '/' + path);
  const auth = 'Basic ' + btoa(`${env.ODATA_USER}:${env.ODATA_PASSWORD}`);
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) {
    let d = ''; try { d = onecErrText(await res.text()); } catch (e) {}
    throw new Error('1С OData ' + res.status + ' на ' + path.split('?')[0] + (d ? ' — ' + d : ''));
  }
  return res.json();
}

// Запись в 1С через OData (POST/PATCH). Возвращает JSON ответа (для POST — созданный объект с Ref_Key).
async function odataWrite(env, method, path, body) {
  if (!env.ODATA_URL) throw new Error('ODATA_URL не задан (секрет)');
  const base = encodeURI(env.ODATA_URL.replace(/\/+$/, '') + '/' + path);
  const url = base + (path.includes('?') ? '&' : '?') + '$format=json';
  const auth = 'Basic ' + btoa(`${env.ODATA_USER}:${env.ODATA_PASSWORD}`);
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  if (!res.ok) {
    let d = ''; try { d = onecErrText(await res.text()); } catch (e) {}
    throw new Error('1С OData ' + method + ' ' + res.status + ' на ' + path.split('?')[0] + (d ? ' — ' + d : ''));
  }
  return res.json().catch(() => null);
}

async function syncStatus(env) {
  const r = await env.DB.prepare('SELECT entity, last_at, info FROM sync_state').all();
  return json(r.results);
}

// Удаление демо/фиктивных записей (фикстуры из seed.sql) по их точным id.
// Клиенты/товары/поставщики, привязанные к 1С (ext_ref IS NOT NULL), НЕ удаляются —
// они уже реальные. Сделки/счета/отгрузки в 1С не синхронизируются, поэтому удаляются полностью.
async function clearDemoData(env) {
  const DEALS = ['d001','d002','d003','d004','d005','d006','d007','d008','d009','d010','d011','d012'];
  const INVOICES = ['iv01','iv02','iv03','iv04','iv05','iv06'];
  const SHIPMENTS = ['sh01','sh02','sh03','sh04'];
  const CLIENTS = ['cl01','cl02','cl03','cl04','cl05','cl06','cl07','cl08','cl09','cl10','cl11','cl12','cl13','cl14','cl15'];
  const PRODUCTS = ['p001','p002','p003','p004','p005','p101','p102','p103','p201','p202','p203','p204','p301','p302','p303','p401','p402','p501','p502','p601','p602','p701','p702','p801','p901'];
  const SUPPLIERS = ['sp1','sp2','sp3','sp4','sp5'];
  const ph = (a) => a.map(() => '?').join(',');
  const run = async (sql, args) => { try { const r = await env.DB.prepare(sql).bind(...args).run(); return (r.meta && r.meta.changes) || 0; } catch (e) { return 0; } };
  const result = {};

  // 1) Документы (счета) — демо
  result.invoices = await run(`DELETE FROM invoices WHERE id IN (${ph(INVOICES)})`, INVOICES);
  // 2) Отгрузки — демо
  result.shipments = await run(`DELETE FROM shipments WHERE id IN (${ph(SHIPMENTS)})`, SHIPMENTS);

  // 3) Сделки — демо (очищаем связи, затем удаляем)
  await run(`UPDATE tasks SET deal_id=NULL WHERE deal_id IN (${ph(DEALS)})`, DEALS);
  await run(`UPDATE invoices SET deal_id=NULL WHERE deal_id IN (${ph(DEALS)})`, DEALS);
  await run(`UPDATE shipments SET deal_id=NULL WHERE deal_id IN (${ph(DEALS)})`, DEALS);
  await run(`DELETE FROM deal_items WHERE deal_id IN (${ph(DEALS)})`, DEALS);
  await run(`DELETE FROM deal_stage_history WHERE deal_id IN (${ph(DEALS)})`, DEALS);
  result.deals = await run(`DELETE FROM deals WHERE id IN (${ph(DEALS)})`, DEALS);

  // 4) Клиенты — только демо без привязки к 1С
  const delClients = `SELECT id FROM clients WHERE id IN (${ph(CLIENTS)}) AND ext_ref IS NULL`;
  await run(`UPDATE deals SET client_id=NULL WHERE client_id IN (${delClients})`, CLIENTS);
  await run(`UPDATE invoices SET client_id=NULL WHERE client_id IN (${delClients})`, CLIENTS);
  await run(`UPDATE shipments SET client_id=NULL WHERE client_id IN (${delClients})`, CLIENTS);
  await run(`DELETE FROM client_tags WHERE client_id IN (${delClients})`, CLIENTS);
  result.clients = await run(`DELETE FROM clients WHERE id IN (${ph(CLIENTS)}) AND ext_ref IS NULL`, CLIENTS);

  // 5) Товары — только демо без привязки к 1С
  const delProducts = `SELECT id FROM products WHERE id IN (${ph(PRODUCTS)}) AND ext_ref IS NULL`;
  await run(`DELETE FROM deal_items WHERE product_id IN (${delProducts})`, PRODUCTS);
  await run(`DELETE FROM product_stock WHERE product_id IN (${delProducts})`, PRODUCTS);
  await run(`DELETE FROM stock_movements WHERE product_id IN (${delProducts})`, PRODUCTS);
  result.products = await run(`DELETE FROM products WHERE id IN (${ph(PRODUCTS)}) AND ext_ref IS NULL`, PRODUCTS);

  // 6) Поставщики — только демо без привязки к 1С
  result.suppliers = await run(`DELETE FROM suppliers WHERE id IN (${ph(SUPPLIERS)}) AND ext_ref IS NULL`, SUPPLIERS);

  return json({ cleared: result });
}

// Интервалы фоновой синхронизации (минуты), по требованиям заказчика
// Интервалы фоновой синхронизации (мин). Фактический минимум ограничен шагом
// планировщика GitHub Actions (~5 мин), поэтому значения ≤5 = «на каждом прогоне».
// Частое и важное (остатки/клиенты/приходы) — каждые ~5 мин; тяжёлая номенклатура — реже.
const SYNC_INTERVALS = {
  clients_1c: 4,      // контрагенты — на каждом прогоне (~5 мин)
  suppliers_1c: 10,   // поставщики — ~10 мин
  products_1c: 30,    // номенклатура: полный проход всей базы ~10k+ (резюмируемо), обновление ~30 мин
  units_1c: 60,       // единицы измерения номенклатуры — редко меняются (нужны для опт/розницы из приходов)
  categories_1c: 60,  // категории — редко меняются
  company_1c: 360,    // реквизиты организации — редко (раз в ~6 ч)
  stock_1c: 4,        // остатки — на каждом прогоне (~5 мин)
  receipts_1c: 4,     // приходы — на каждом прогоне (~5 мин)
  prices_1c: 8,       // опт/розница из приходов по единице измерения — ~10 мин (и сразу после прихода)
  saleprices_1c: 10,  // закуп из регистра цен 1С + опт/розница в пробелы — ~10 мин (+ сразу после полного прохода номенклатуры)
  invoice_payments_1c: 15, // статус оплаты счетов из платежей 1С (банк+касса, FIFO) — ~15 мин
  reserve_expiry: 60,      // проверка истёкших резервов (стадия «Резерв») — раз в час
};
// Запускает только «просроченные» синхронизации (по last_at в sync_state).
async function runDueSyncs(env) {
  const ran = [], errors = [];
  const stRows = await env.DB.prepare('SELECT entity, last_at FROM sync_state').all();
  const lastAt = {};
  for (const r of stRows.results) lastAt[r.entity] = r.last_at;
  const now = Date.now();
  const due = (entity) => {
    const raw = lastAt[entity];
    const t = raw ? Date.parse(String(raw).replace(' ', 'T') + 'Z') : 0;
    return (now - (Number.isFinite(t) ? t : 0)) >= (SYNC_INTERVALS[entity] || 60) * 60 * 1000;
  };
  const run = async (name, fn) => { try { await fn(); ran.push(name); } catch (e) { errors.push(name + ': ' + ((e && e.message) || e)); } };

  if (due('clients_1c')) await run('clients', () => syncClients(env));
  if (due('suppliers_1c')) await run('suppliers', () => syncSuppliers(env));
  if (due('categories_1c')) await run('categories', () => syncCategories(env));
  if (due('company_1c')) await run('company', () => syncCompany1C(env));
  // номенклатура: если полный проход ещё идёт (products_offset>0) — продолжаем каждый
  // запуск; иначе запускаем новый проход по интервалу.
  const prodOff = parseInt((await getSetting(env, 'products_offset')) || '0', 10) || 0;
  if (prodOff > 0 || due('products_1c')) await run('products', () => syncProductsAll(env));
  if (due('stock_1c')) await run('stock', () => syncStock(env));
  let receiptsRan = false;
  if (due('receipts_1c')) { await run('receipts', () => syncReceipts(env)); receiptsRan = true; }
  // опт/розница из приходов (по единице измерения): сразу после прихода ИЛИ периодически
  if (receiptsRan || due('prices_1c')) await run('prices', () => syncPrices(env, 'last'));
  // закуп из регистра цен 1С + опт/розница в незаполненные приходами позиции
  if (due('saleprices_1c')) await run('saleprices', () => syncSalePrices(env));
  // статус оплаты счетов из 1С (Вариант A: по платежам банк+касса, FIFO)
  if (due('invoice_payments_1c')) await run('invoice_payments', () => syncInvoicePayments(env));
  if (due('reserve_expiry')) await run('reserve_expiry', () => scanReserveExpiry(env));
  // единицы измерения — в самом конце (резюмируемо), чтобы тяжёлый проход не вытеснял цены
  const unitOff = parseInt((await getSetting(env, 'units_offset')) || '0', 10) || 0;
  if (unitOff > 0 || due('units_1c')) await run('units', () => syncUnits(env));
  // этап 4: до-сылаем отложенные/упавшие отправки в 1С (контрагенты/счета/отгрузки)
  try { const q = await processOnecQueue(env); if (q.processed) ran.push(`queue ${q.ok}/${q.processed}`); }
  catch (e) { errors.push('queue: ' + ((e && e.message) || e)); }
  return { ran, errors, at: new Date().toISOString() };
}

// Контрагенты 1С -> клиенты CRM. Идемпотентно по ext_ref (Ref_Key) и БИН.
async function syncClients(env) {
  const ex = await env.DB.prepare('SELECT id, ext_ref, bin FROM clients').all();
  const byRef = {}, byBin = {};
  for (const c of ex.results) { if (c.ext_ref) byRef[c.ext_ref] = c.id; if (c.bin) byBin[c.bin] = c.id; }

  // Контактная информация контрагентов: телефон/email по Ref_Key (табличная часть
  // КонтактнаяИнформация). Нужны для сопоставления входящих WhatsApp/звонков с клиентом.
  // Необязательно — если сущность недоступна, синк продолжается без телефонов.
  const phoneByRef = {}, emailByRef = {};
  try {
    let cskip = 0;
    const cbase = 'Catalog_Контрагенты_КонтактнаяИнформация?$format=json&$orderby=Ref_Key&$select=Ref_Key,Тип,Представление';
    while (true) {
      const data = await odataGet(env, `${cbase}&$top=1000&$skip=${cskip}`);
      const rows = data.value || [];
      if (!rows.length) break;
      for (const r of rows) {
        const ref = r.Ref_Key; const val = String(r['Представление'] || '').trim();
        if (!ref || !val) continue;
        const type = String(r['Тип'] || '');
        if (/тел/i.test(type)) { if (!phoneByRef[ref]) phoneByRef[ref] = val; }
        else if (/почт|email|mail/i.test(type)) { if (!emailByRef[ref]) emailByRef[ref] = val; }
      }
      if (rows.length < 1000) break;
      cskip += 1000;
    }
  } catch (e) { /* контактная информация недоступна — пропускаем */ }

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
      const phone = String(phoneByRef[ref] || '').trim();
      const email = String(emailByRef[ref] || '').trim();
      let id = byRef[ref] || (bin && byBin[bin]) || null;
      if (id) {
        // телефон/email из 1С не затирают вручную заполненные значения
        stmts.push(env.DB.prepare(
          `UPDATE clients SET name=?, bin=?, ext_ref=?,
             phone=COALESCE(NULLIF(phone,''), NULLIF(?,'')),
             email=COALESCE(NULLIF(NULLIF(email,''),'—'), NULLIF(?,''), email)
           WHERE id=?`
        ).bind(name, bin, ref, phone, email, id));
        updated++;
      } else {
        id = genId();
        stmts.push(env.DB.prepare('INSERT INTO clients (id,name,bin,type_key,ext_ref,balance,ltv,phone,email) VALUES (?,?,?,?,?,0,0,?,?)').bind(id, name, bin, 'opt', ref, phone || null, email || '—'));
        created++;
      }
      byRef[ref] = id; if (bin) byBin[bin] = id;
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    if (rows.length < top) break;
    skip += top;
  }

  const info = `получено ${fetched}, новых ${created}, обновлено ${updated}, с телефоном ${Object.keys(phoneByRef).length}`;
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('clients_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ fetched, created, updated });
}

// Колонки ext_ref и bin у поставщиков (для синхронизации с 1С) — добавляем на лету
let SUPPLIER_EXTREF_OK = false;
async function ensureSupplierExtRef(env) {
  if (SUPPLIER_EXTREF_OK) return;
  for (const ddl of ['ALTER TABLE suppliers ADD COLUMN ext_ref TEXT', 'ALTER TABLE suppliers ADD COLUMN bin TEXT']) {
    try { await env.DB.prepare(ddl).run(); } catch (e) {}
  }
  // Удаляем демо-поставщиков из seed (sp1..sp5) — больше не нужны.
  try { await env.DB.prepare("DELETE FROM suppliers WHERE id IN ('sp1','sp2','sp3','sp4','sp5')").run(); } catch (e) {}
  SUPPLIER_EXTREF_OK = true;
}

// Поставщики 1С = контрагенты, у которых есть документы поступления (приходы).
// Имена берём из уже синхронизированных контрагентов (таблица clients по ext_ref),
// как и в syncReceipts. Идемпотентно по ext_ref (Ref_Key) и наименованию.
async function syncSuppliers(env) {
  await ensureSupplierExtRef(env);
  // существующие поставщики CRM
  const ex = await env.DB.prepare('SELECT id, ext_ref, name FROM suppliers').all();
  const byRef = {}, byName = {};
  for (const s of ex.results) { if (s.ext_ref) byRef[s.ext_ref] = s.id; if (s.name) byName[String(s.name).toLowerCase()] = s.id; }

  // имя и БИН контрагента по Ref_Key (контрагенты лежат в clients после syncClients)
  const cl = await env.DB.prepare('SELECT ext_ref, name, bin FROM clients WHERE ext_ref IS NOT NULL').all();
  const nameByRef = {}, binByRef = {};
  for (const c of cl.results) { nameByRef[c.ext_ref] = c.name; binByRef[c.ext_ref] = c.bin; }

  // уникальные контрагенты-поставщики из документов поступления
  const supRefs = new Set();
  const TOP = 10000;
  let skip = 0;
  const hbase = 'Document_ПоступлениеТоваровУслуг?$format=json&$orderby=Ref_Key&$select=Контрагент_Key';
  while (true) {
    const data = await odataGet(env, `${hbase}&$top=${TOP}&$skip=${skip}`);
    const rows = data.value || [];
    if (!rows.length) break;
    for (const r of rows) { const k = r['Контрагент_Key']; if (k && k !== '00000000-0000-0000-0000-000000000000') supRefs.add(k); }
    if (rows.length < TOP) break;
    skip += TOP;
  }

  // Контактная информация контрагентов: телефон (номер) и email по Ref_Key.
  // Лежат в табличной части КонтактнаяИнформация (не прямым полем). Необязательно —
  // если сущность недоступна в этой базе, синк продолжается без телефонов.
  const phoneByRef = {}, emailByRef = {};
  try {
    let cskip = 0;
    const cbase = 'Catalog_Контрагенты_КонтактнаяИнформация?$format=json&$orderby=Ref_Key&$select=Ref_Key,Тип,Представление';
    while (true) {
      const data = await odataGet(env, `${cbase}&$top=${TOP}&$skip=${cskip}`);
      const rows = data.value || [];
      if (!rows.length) break;
      for (const r of rows) {
        const ref = r.Ref_Key; const val = String(r['Представление'] || '').trim();
        if (!ref || !val) continue;
        const type = String(r['Тип'] || '');
        if (/тел/i.test(type)) { if (!phoneByRef[ref]) phoneByRef[ref] = val; }
        else if (/почт|email|mail/i.test(type)) { if (!emailByRef[ref]) emailByRef[ref] = val; }
      }
      if (rows.length < TOP) break;
      cskip += TOP;
    }
  } catch (e) { /* контактная информация недоступна — пропускаем */ }

  let created = 0, updated = 0, noName = 0;
  const stmts = [];
  for (const ref of supRefs) {
    const name = String(nameByRef[ref] || '').trim();
    if (!name) { noName++; continue; } // имя появится после следующего синка контрагентов
    const bin = String(binByRef[ref] || '').trim();
    const phone = String(phoneByRef[ref] || '').trim();
    const email = String(emailByRef[ref] || '').trim();
    let id = byRef[ref] || byName[name.toLowerCase()] || null;
    if (id) {
      // не затираем вручную заполненные поля пустыми значениями из 1С
      stmts.push(env.DB.prepare(
        `UPDATE suppliers SET name=?, ext_ref=?,
           bin=COALESCE(NULLIF(?,''), bin),
           phone=COALESCE(NULLIF(?,''), phone),
           email=COALESCE(NULLIF(?,''), email)
         WHERE id=?`
      ).bind(name, ref, bin, phone, email, id));
      updated++;
    } else {
      id = genId();
      stmts.push(env.DB.prepare('INSERT INTO suppliers (id,name,bin,phone,email,share,ext_ref) VALUES (?,?,?,?,?,0,?)').bind(id, name, bin, phone, email, ref));
      created++;
    }
    byRef[ref] = id; byName[name.toLowerCase()] = id;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const info = `контрагентов-поставщиков ${supRefs.size}, новых ${created}, обновлено ${updated}` + (noName ? `, без имени ${noName}` : '');
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('suppliers_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ suppliers: supRefs.size, created, updated, noName });
}

// Номенклатура 1С (только товары, Услуга=false) -> товары CRM.
// Одна страница за вызов (limit ≤ 1000, со смещением skip) — фронт листает до done.
// Upsert по sku (=Code), без предзагрузки карт — масштабируется на тысячи позиций.
// Одна страница номенклатуры из 1С (до 1000). Плоский результат, без записи в sync_state.
async function syncProductsPage(env, skip, limit) {
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
  return { fetched: rows.length, created, updated: processed - created, next: off + rows.length, done: rows.length < top };
}

// Ручной вызов одной страницы (эндпоинт /api/sync/1c/products?limit&skip).
async function syncProducts(env, limit, skip) {
  const r = await syncProductsPage(env, skip, limit);
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('products_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(`обработано до ${r.next}` + (r.done ? ' (готово)' : ' (идёт…)')).run();
  return json(r);
}

// Полная синхронизация ВСЕЙ номенклатуры (резюмируемо). 1С отдаёт по 1000/запрос,
// каталог большой (~10k+), поэтому идём пачками; смещение храним в products_offset и
// продолжаем со следующего фонового запуска, пока не дойдём до конца. После полного
// прохода пересчитываем цены (опт/розница из приходов, закуп из регистра); единицы
// измерения подтягивает отдельный резюмируемый проход (syncUnits в runDueSyncs).
const PRODUCTS_PAGES_PER_RUN = 4;
async function syncProductsAll(env) {
  await ensureAppSettings(env);
  let off = parseInt((await getSetting(env, 'products_offset')) || '0', 10) || 0;
  let done = false;
  for (let p = 0; p < PRODUCTS_PAGES_PER_RUN; p++) {
    const r = await syncProductsPage(env, off);
    off = r.next;
    if (r.done || r.fetched === 0) { done = true; break; }
  }
  if (done) {
    await setSetting(env, 'products_offset', '0');
    const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n;
    await env.DB.prepare(
      `INSERT INTO sync_state (entity, last_at, info) VALUES ('products_1c', datetime('now'), ?)
       ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
    ).bind(`готово: ${total} позиций`).run();
    try { await syncPrices(env, 'last'); } catch (e) {}      // опт/розница из приходов по единице измерения
    try { await syncSalePrices(env); } catch (e) {}          // закуп из регистра; опт/розница из регистра — в пробелы
    // единицы измерения подтягивает отдельный резюмируемый проход (runDueSyncs)
  } else {
    await setSetting(env, 'products_offset', String(off));
    await env.DB.prepare(
      `INSERT INTO sync_state (entity, last_at, info) VALUES ('products_1c', datetime('now'), ?)
       ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
    ).bind(`идёт… обработано до ${off}`).run();
  }
  return { off, done };
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

// Единицы измерения номенклатуры 1С -> products.unit. Имя справочника единиц и поле-ссылку
// на единицу у номенклатуры в разных конфигурациях называют по-разному, поэтому пробуем
// несколько вариантов: словарь единиц объединяем из всех известных справочников, а поле
// у номенклатуры берём первое валидное (проверяем пробным запросом).
const UNITS_PAGES_PER_RUN = 4;
async function syncUnits(env) {
  await ensureAppSettings(env);
  const logState = async (msg) => {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (entity, last_at, info) VALUES ('units_1c', datetime('now'), ?)
         ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
      ).bind(String(msg).slice(0, 300)).run();
    } catch (e) {}
  };

  // 1) словарь единиц: Ref_Key -> название ("шт","м","кг","упак",...) из всех известных справочников
  const unitName = {};
  for (const cat of ['Catalog_КлассификаторЕдиницИзмерения', 'Catalog_ЕдиницыИзмерения', 'Catalog_УпаковкиЕдиницыИзмерения']) {
    try {
      let skip = 0;
      while (true) {
        const d = await odataGet(env, `${cat}?$format=json&$select=Ref_Key,Description&$top=1000&$skip=${skip}`);
        const rows = d.value || [];
        for (const r of rows) if (r.Description) unitName[r.Ref_Key] = String(r.Description).trim();
        if (rows.length < 1000) break; skip += 1000;
      }
    } catch (e) {}
  }
  if (!Object.keys(unitName).length) { await logState('справочник единиц измерения не найден в 1С'); return json({ ok: false }); }

  // 2) поле-ссылка на единицу у номенклатуры: первое валидное (кэшируем в настройках)
  let unitField = await getSetting(env, 'unit_field');
  if (!unitField) {
    for (const fld of ['ЕдиницаХраненияОстатков_Key', 'БазоваяЕдиницаИзмерения_Key', 'ЕдиницаИзмерения_Key']) {
      try {
        await odataGet(env, `Catalog_Номенклатура?$format=json&$select=Ref_Key,${fld}&$top=1`);
        unitField = fld; break;
      } catch (e) {}
    }
    if (!unitField) { await logState('поле единицы измерения не найдено в Catalog_Номенклатура'); return json({ ok: false }); }
    await setSetting(env, 'unit_field', unitField);
  }

  // 3) резюмируемый проход номенклатуры (по UNITS_PAGES_PER_RUN×1000 за вызов),
  //    смещение храним в units_offset — чтобы не упереться в лимит времени запроса
  let off = parseInt((await getSetting(env, 'units_offset')) || '0', 10) || 0;
  const base = `Catalog_Номенклатура?$format=json&$filter=IsFolder eq false&$orderby=Ref_Key&$select=Ref_Key,${unitField}`;
  let scanned = 0, updated = 0, noName = 0, done = false;
  for (let p = 0; p < UNITS_PAGES_PER_RUN; p++) {
    const d = await odataGet(env, `${base}&$top=1000&$skip=${off}`);
    const rows = d.value || [];
    if (!rows.length) { done = true; break; }
    const stmts = [];
    for (const r of rows) {
      scanned++;
      const nm = r[unitField] && unitName[r[unitField]];
      if (!nm) { noName++; continue; }
      stmts.push(env.DB.prepare('UPDATE products SET unit=? WHERE ext_ref=?').bind(nm, r.Ref_Key));
      updated++;
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    off += rows.length;
    if (rows.length < 1000) { done = true; break; }
  }
  if (done) {
    await setSetting(env, 'units_offset', '0');
    await logState(`готово (поле ${unitField}): в этом проходе обновлено ${updated}, без названия ед. ${noName}`);
  } else {
    await setSetting(env, 'units_offset', String(off));
    await logState(`идёт… (поле ${unitField}) обработано до ${off}, обновлено в проходе ${updated}`);
  }
  return json({ field: unitField, scanned, updated, noName, off, done });
}

// Куда отнести цену из прихода по единице измерения товара: штучный -> розница,
// погонный/весовой/упаковочный -> опт. Неизвестную/пустую единицу считаем штучной.
function priceKindByUnit(unit) {
  const u = String(unit || '').toLowerCase();
  if (!u) return 'retail';
  return /шт|штук/.test(u) ? 'retail' : 'wholesale';
}

// Ценообразование (раздел «Ценообразование» в настройках): формулы опт/розницы от приходной цены.
async function getPricingConfig(env) {
  return {
    enabled: (await getSetting(env, 'pricing_enabled')) === '1',
    opt: parseFloat(await getSetting(env, 'pricing_opt_pct')) || 0,            // наценка средний опт, %
    optLarge: parseFloat(await getSetting(env, 'pricing_opt_large_pct')) || 0, // наценка крупный опт, %
    rozn: parseFloat(await getSetting(env, 'pricing_rozn_pct')) || 0,          // наценка розница, %
    vat: parseFloat(await getSetting(env, 'pricing_vat_pct')) || 0,            // НДС, %
  };
}
// price_wholesale = средний опт; price_wholesale_large = крупный опт; price_retail = розница.
let PRICE_COLS_OK = false;
async function ensurePriceColumns(env) {
  if (PRICE_COLS_OK) return;
  try { await env.DB.prepare('ALTER TABLE products ADD COLUMN price_wholesale_large REAL').run(); } catch (e) {}
  PRICE_COLS_OK = true;
}
async function pricingSettingsGet(env) { await ensureAppSettings(env); return json(await getPricingConfig(env)); }
async function pricingSettingsSave(env, request) {
  await ensureAppSettings(env);
  await ensurePriceColumns(env);
  const b = await request.json().catch(() => ({}));
  if (b.enabled != null) await setSetting(env, 'pricing_enabled', b.enabled ? '1' : '0');
  if (b.opt != null) await setSetting(env, 'pricing_opt_pct', String(Number(b.opt) || 0));
  if (b.optLarge != null) await setSetting(env, 'pricing_opt_large_pct', String(Number(b.optLarge) || 0));
  if (b.rozn != null) await setSetting(env, 'pricing_rozn_pct', String(Number(b.rozn) || 0));
  if (b.vat != null) await setSetting(env, 'pricing_vat_pct', String(Number(b.vat) || 0));
  // Сразу применяем формулу ко всему каталогу (по закупу), чтобы цены пересчитались
  // не дожидаясь следующей синхронизации цен. Если выключено — очищаем опт/розницу.
  const pc = await getPricingConfig(env);
  let applied = 0;
  if (pc.enabled) {
    const vatM = 1 + (pc.vat / 100);
    const optM = (1 + pc.opt / 100) * vatM;          // средний опт
    const optLM = (1 + pc.optLarge / 100) * vatM;    // крупный опт
    const roznM = (1 + pc.rozn / 100) * vatM;        // розница
    const res = await env.DB.prepare(
      'UPDATE products SET price_wholesale=ROUND(price_cost*?,2), price_wholesale_large=ROUND(price_cost*?,2), price_retail=ROUND(price_cost*?,2) WHERE price_cost IS NOT NULL AND price_cost>0'
    ).bind(optM, optLM, roznM).run();
    applied = (res.meta && res.meta.changes) || 0;
  } else {
    await env.DB.prepare('UPDATE products SET price_wholesale=0, price_wholesale_large=0, price_retail=0').run();
  }
  const out = await getPricingConfig(env);
  return json({ ...out, applied });
}

// Цены из приходов 1С -> опт/розница товара по единице измерения (price_retail для штучных,
// price_wholesale для прочих). Закупочную цену приходы НЕ трогают — она тянется из регистра цен.
//   mode='last' (по умолчанию): цена из ПОСЛЕДНЕГО по дате прихода прихода по номенклатуре;
//   mode='avg': среднее значение цены по всем приходам номенклатуры.
// Документ Поступление и его табл. часть Товары идут отдельными OData-сущностями,
// $expand табличной части 1С не поддерживает (501), поэтому шапки и строки
// тянем порознь и соединяем по ссылке (Ref_Key) в памяти.
// Цену нормируем к базовой единице: Цена / Коэффициент (как остатки в регистре).
async function syncPrices(env, mode) {
  await ensurePriceColumns(env);
  const isAvg = mode === 'avg';
  const TOP = 10000;

  // карта товаров: Ref_Key номенклатуры -> { id, unit } (единица нужна для выбора опт/розница)
  const prods = await env.DB.prepare('SELECT id, ext_ref, unit FROM products WHERE ext_ref IS NOT NULL').all();
  const byRef = {};
  for (const p of prods.results) byRef[p.ext_ref] = { id: p.id, unit: p.unit };

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

  // 3) запись цены прихода в цены товара.
  //   Закуп = приходная цена (всегда). Опт/Розница выводятся через «Ценообразование»:
  //   если формулы включены — опт/розница = закуп+наценка% (+НДС); иначе опт/розница пусты.
  // Одноразово очищаем старые опт/розница (раньше заполнялись из приходов по единице).
  try {
    await ensureAppSettings(env);
    if (!(await getSetting(env, 'optrozn_reset_v1'))) {
      await env.DB.prepare('UPDATE products SET price_wholesale=0, price_retail=0').run();
      await setSetting(env, 'optrozn_reset_v1', '1');
    }
  } catch (e) {}
  const pc = await getPricingConfig(env);
  const stmts = [];
  let updW = 0, updR = 0, updC = 0, missing = 0, priced = 0;
  for (const nk in agg) {
    const a = agg[nk];
    const price = isAvg ? a.sum / a.count : a.price;
    if (!Number.isFinite(price) || price <= 0) continue;
    priced++;
    const p = byRef[nk];
    if (!p) { missing++; continue; }
    const cost = Math.round(price * 100) / 100;
    if (pc.enabled) {
      const vat = 1 + (pc.vat / 100);
      const opt = Math.round(price * (1 + pc.opt / 100) * vat * 100) / 100;        // средний опт
      const optL = Math.round(price * (1 + pc.optLarge / 100) * vat * 100) / 100;  // крупный опт
      const rozn = Math.round(price * (1 + pc.rozn / 100) * vat * 100) / 100;      // розница
      stmts.push(env.DB.prepare('UPDATE products SET price_cost=?, price_wholesale=?, price_wholesale_large=?, price_retail=? WHERE id=?').bind(cost, opt, optL, rozn, p.id));
      updC++; updW++; updR++;
    } else {
      // закуп из прихода; опт/розницу очищаем — они задаются через «Ценообразование»
      stmts.push(env.DB.prepare('UPDATE products SET price_cost=?, price_wholesale=0, price_wholesale_large=0, price_retail=0 WHERE id=?').bind(cost, p.id));
      updC++;
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  // Опт/Розница по формуле — для ВСЕХ товаров с закупом (а не только тех, что были в приходах
  // этого прохода): закуп мог прийти из регистра цен или быть задан раньше. Так формула
  // покрывает весь каталог, где есть закупочная цена.
  let formulaAll = 0;
  if (pc.enabled) {
    const vatM = 1 + (pc.vat / 100);
    const optM = (1 + pc.opt / 100) * vatM;
    const optLM = (1 + pc.optLarge / 100) * vatM;
    const roznM = (1 + pc.rozn / 100) * vatM;
    const res = await env.DB.prepare(
      'UPDATE products SET price_wholesale=ROUND(price_cost*?,2), price_wholesale_large=ROUND(price_cost*?,2), price_retail=ROUND(price_cost*?,2) WHERE price_cost IS NOT NULL AND price_cost>0'
    ).bind(optM, optLM, roznM).run();
    formulaAll = (res.meta && res.meta.changes) || 0;
  }

  const info = pc.enabled
    ? `формулы (опт +${pc.opt}%, розн +${pc.rozn}%, НДС ${pc.vat}%): приходов ${docs}, строк ${lines}, с ценой ${priced}, закуп ${updC}, опт/розн по формуле ${formulaAll}, не сопоставлено ${missing}`
    : `закуп из приходов: приходов ${docs}, строк ${lines}, закуп ${updC}, не сопоставлено ${missing} (опт/розница — через ценообразование)`;
  await env.DB.prepare(
    `INSERT INTO sync_state (entity, last_at, info) VALUES ('prices_1c', datetime('now'), ?)
     ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
  ).bind(info).run();
  return json({ mode: isAvg ? 'avg' : 'last', docs, lines, priced, wholesale: updW, retail: updR, missing });
}

// Цены из регистра «Цены номенклатуры» 1С (РегистрСведений ЦеныНоменклатуры).
// Берём последнюю цену по каждому виду цен и раскладываем по закуп/опт/рознице (по названию
// вида цены). Закупочная цена берётся ТОЛЬКО отсюда; опт/розница — только в пробелы,
// которые не заполнили приходы (syncPrices).
// Определяем реальные имена измерений/ресурсов регистра по образцу записи (в разных
// конфигурациях они отличаются: Номенклатура/Товар, ВидЦены/ТипЦен, Цена/Стоимость).
function detectPriceFields(sample) {
  const keys = Object.keys(sample);
  const find = (re) => keys.find((k) => re.test(k));
  const nomKey = find(/^номенклатура.*_key$/i) || find(/(номенклатур|товар|product).*_key$/i) || find(/_key$/i);
  // только по шаблону вида цены — без «любой _Key», иначе ошибочно берётся Ref_Key документа
  const typeKey = find(/(видцен|типцен|видцены|типцены|вид_цен|тип_цен|price).*_key$/i) || null;
  const priceField = find(/^цена$/i) || find(/цена|стоим|price|amount/i)
               || keys.find((k) => typeof sample[k] === 'number');
  const periodField = find(/^период$/i) || find(/period/i);
  return { nomKey, typeKey, priceField, periodField };
}

// Читаем регистр «Цены номенклатуры». $select не задаём жёстко — определяем поля по образцу.
// Если регистр ПОДЧИНЁН РЕГИСТРАТОРУ (поля Recorder/RecordSet вместо измерений), записи нельзя
// получить через $expand (1С: 501 — $expand только для ссылочных реквизитов), поэтому читаем
// исходный документ установки цен (его табличную часть), как делаем с приходами.
async function fetchPriceRegister(env) {
  const REG = 'InformationRegister_ЦеныНоменклатуры';
  const d0 = await odataGet(env, `${REG}?$format=json&$top=1`);
  let sample = (d0.value || [])[0] || null;
  if (!sample) return { rows: [], fields: null, keys: [] };
  const keys = Object.keys(sample);

  // регистр подчинён регистратору — читаем документ установки цен
  const recorderBound = keys.includes('RecordSet') && !keys.some((k) => /_key$/i.test(k));
  if (recorderBound) return await fetchPriceRegisterFromDoc(env);

  // плоский (независимый) регистр — читаем напрямую
  let out = [], skip = 0;
  while (true) {
    const d = await odataGet(env, `${REG}?$format=json&$top=5000&$skip=${skip}`);
    const rows = d.value || []; out = out.concat(rows);
    if (rows.length < 5000) break; skip += 5000;
  }
  return { rows: out, fields: detectPriceFields(sample), keys, nested: false };
}

// Цены из документа установки цен (регистратор регистра ЦеныНоменклатуры). Имя документа берём
// из Recorder_Type, табличную часть и её поля определяем перебором/по образцу. За «последнюю»
// цену берём строку из самого позднего по дате документа (как в приходах).
async function fetchPriceRegisterFromDoc(env) {
  const REG = 'InformationRegister_ЦеныНоменклатуры';
  // 1) типы регистраторов (документы установки цен) — хватает первых страниц
  const recTypes = new Set();
  let skip = 0;
  for (let p = 0; p < 3; p++) {
    const d = await odataGet(env, `${REG}?$format=json&$top=5000&$skip=${skip}`);
    const rows = d.value || [];
    for (const r of rows) if (r.Recorder_Type) recTypes.add(String(r.Recorder_Type));
    if (rows.length < 5000) break; skip += 5000;
  }
  const docNames = [...recTypes].map((t) => t.split('.').pop()).filter((n) => /^Document_/.test(n));
  if (!docNames.length) docNames.push('Document_УстановкаЦенНоменклатуры');

  let out = [], fields = null, usedDoc = null, usedTab = null;
  for (const doc of docNames) {
    // табличная часть: подбираем по наличию полей номенклатуры и цены
    let tabName = null, f = null;
    for (const ts of ['Товары', 'ЦеныНоменклатуры', 'Цены', 'СтрокиЦен', 'ТоварыЦены']) {
      try {
        const pr = await odataGet(env, `${doc}_${ts}?$format=json&$top=1`);
        const s = (pr.value || [])[0]; if (!s) continue;
        const ff = detectPriceFields(s);
        if (ff.nomKey && ff.priceField) { tabName = ts; f = ff; break; }
      } catch (e) {}
    }
    if (!tabName) continue;
    usedDoc = doc; usedTab = tabName; fields = f;

    // вид цены в этом документе может быть в ШАПКЕ (а не в строке) — определяем поле шапки
    let headTypeField = null;
    if (!f.typeKey) {
      try {
        const hp = await odataGet(env, `${doc}?$format=json&$top=1`);
        const hs = (hp.value || [])[0] || {};
        headTypeField = Object.keys(hs).find((k) => /_key$/i.test(k) && /(видцен|типцен|вид_цен|тип_цен|видцены|типцены)/i.test(k)) || null;
      } catch (e) {}
    }

    // шапки: дата (для последней цены) и вид цены (если он в шапке)
    const dateByDoc = {}, typeByDoc = {};
    const hsel = headTypeField ? `&$select=Ref_Key,Date,${headTypeField}` : '&$select=Ref_Key,Date';
    let sk = 0;
    while (true) {
      const d = await odataGet(env, `${doc}?$format=json&$orderby=Ref_Key${hsel}&$top=5000&$skip=${sk}`);
      const rows = d.value || [];
      for (const r of rows) { dateByDoc[r.Ref_Key] = String(r.Date || ''); if (headTypeField) typeByDoc[r.Ref_Key] = r[headTypeField]; }
      if (rows.length < 5000) break; sk += 5000;
    }
    // строки табличной части
    sk = 0;
    while (true) {
      const d = await odataGet(env, `${doc}_${tabName}?$format=json&$orderby=Ref_Key,LineNumber&$top=5000&$skip=${sk}`);
      const rows = d.value || [];
      for (const r of rows) { r.__date = dateByDoc[r.Ref_Key] || ''; if (headTypeField) r.__type = typeByDoc[r.Ref_Key]; out.push(r); }
      if (rows.length < 5000) break; sk += 5000;
    }
    if (headTypeField) { fields.typeKey = '__type'; fields.typeSrc = headTypeField; }
    break; // обычно один тип документа установки цен
  }
  if (!fields) return { rows: [], fields: null, keys: ['регистратор: ' + ([...recTypes].join(' | ') || '—')], nested: true, fromDoc: true };
  fields.periodField = '__date'; // дата документа как «период» для выбора последней цены
  return { rows: out, fields, keys: Object.keys(out[0] || {}), nested: true, fromDoc: true, doc: usedDoc, tab: usedTab };
}

async function syncSalePrices(env) {
  const logState = async (msg) => {
    try {
      await env.DB.prepare(
        `INSERT INTO sync_state (entity, last_at, info) VALUES ('saleprices_1c', datetime('now'), ?)
         ON CONFLICT(entity) DO UPDATE SET last_at=datetime('now'), info=excluded.info`
      ).bind(String(msg).slice(0, 300)).run();
    } catch (e) {}
  };

  await ensureAppSettings(env);
  await ensurePriceCostReset(env); // одноразово очищаем старый закуп из приходов

  const prods = await env.DB.prepare('SELECT id, ext_ref FROM products WHERE ext_ref IS NOT NULL').all();
  const byRef = {}; for (const p of prods.results) byRef[p.ext_ref] = p.id;

  // виды цен: Ref_Key -> название (пробуем несколько вариантов имени справочника)
  const typeName = {};
  for (const cat of ['Catalog_ВидыЦен', 'Catalog_ВидыЦенНоменклатуры', 'Catalog_ТипыЦенНоменклатуры']) {
    try {
      const d = await odataGet(env, `${cat}?$format=json&$select=Ref_Key,Description`);
      for (const r of (d.value || [])) typeName[r.Ref_Key] = String(r.Description || '');
      if (Object.keys(typeName).length) break;
    } catch (e) {}
  }
  const kindOf = (refKey) => {
    const n = (typeName[refKey] || '').toLowerCase();
    if (/закуп|приобрет|поступл|приходн|входящ/.test(n)) return 'cost';
    if (/оптов|опт\b/.test(n)) return 'wholesale';
    if (/рознич|розниц/.test(n)) return 'retail';
    return null;
  };

  let reg;
  try { reg = await fetchPriceRegister(env); }
  catch (e) { await logState('ошибка чтения регистра цен: ' + ((e && e.message) || e)); return json({ ok: false }); }

  const f = reg.fields;
  if (!f || !f.nomKey || !f.priceField) {
    await logState(`не удалось определить поля регистра цен; поля записи: ${(reg.keys || []).join(', ') || '—'}`);
    return json({ ok: false, keys: reg.keys || [] });
  }

  // агрегируем по номенклатуре×виду цены; для периодического регистра берём запись с
  // максимальным «Периодом», для непериодического — единственную (последнюю встреченную)
  const latest = {}; // nk -> { cost, wholesale, retail }
  const bestPeriod = {}; // `${nk}|${kind}` -> период
  for (const r of (reg.rows || [])) {
    const nk = r[f.nomKey]; if (!nk) continue;
    const kind = kindOf(f.typeKey ? r[f.typeKey] : null); if (!kind) continue;
    const price = Number(r[f.priceField]); if (!Number.isFinite(price) || price <= 0) continue;
    if (f.periodField) {
      const key = nk + '|' + kind, per = String(r[f.periodField] || '');
      if (bestPeriod[key] && per < bestPeriod[key]) continue;
      bestPeriod[key] = per;
    }
    (latest[nk] || (latest[nk] = {}))[kind] = price;
  }
  const rnd = (x) => Math.round(x * 100) / 100;

  const stmts = []; let updW = 0, updR = 0, updC = 0, miss = 0;
  for (const nk in latest) {
    const pid = byRef[nk]; if (!pid) { miss++; continue; }
    const v = latest[nk];
    // опт/розницу из регистра НЕ пишем — они выводятся через «Ценообразование» (формулу)
    // закуп из регистра — только в пробелы (для товаров без прихода; иначе закуп = приходная)
    if (v.cost != null) { stmts.push(env.DB.prepare('UPDATE products SET price_cost=? WHERE id=? AND (price_cost IS NULL OR price_cost=0)').bind(rnd(v.cost), pid)); updC++; }
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const foundTypes = [...new Set(Object.values(typeName))].filter(Boolean).slice(0, 10).join(', ');
  const src = reg.fromDoc ? ` (док ${reg.doc}_${reg.tab})` : (reg.nested ? ' (из RecordSet)' : '');
  await logState(`строк ${(reg.rows || []).length}${src} [ном=${f.nomKey}, цена=${f.priceField}]; закуп (в пробелы) ${updC}, не сопоставлено ${miss}; виды цен: ${foundTypes || '—'}`);
  return json({ rows: (reg.rows || []).length, fields: f, cost: updC, missing: miss, types: foundTypes });
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
