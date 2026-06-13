// ============================================================================
// KES CRM — клиент REST API (Слой 4). Подключается ДО data.js/app.js.
//
// Назначение: заменить localStorage на боевой бэкенд (/api/*, Cloudflare D1).
//   * хранит JWT, добавляет его в запросы;
//   * login / logout;
//   * маппинг между схемой БД (snake_case, FK-имена) и формой мокапа
//     (camelCase: cat, priceCost, roleKey, lineItems[].priceUsed и т.п.),
//     чтобы существующие вьюхи app.js работали без переписывания;
//   * loadAllData() — собирает объект state той же формы, что SEED.
//
// Наружу: window.__API__
// ============================================================================
(function () {
  const TOKEN_KEY = 'kes_jwt';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} };
  const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} };

  // Базовый fetch к API. Кидает Error с .status при не-2xx.
  async function apiFetch(path, { method = 'GET', body } = {}) {
    const headers = {};
    const tok = getToken();
    if (tok) headers['authorization'] = 'Bearer ' + tok;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch('/api/' + path.replace(/^\/+/, ''), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const e = new Error((data && data.error) || ('HTTP ' + res.status));
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  async function login(email, password) {
    const r = await apiFetch('login', { method: 'POST', body: { email, password } });
    if (r && r.token) setToken(r.token);
    return r; // { token, user }
  }
  function logout() { clearToken(); }
  const isAuthed = () => !!getToken();

  // ------------------------------------------------------------------
  // Маппинг API (snake_case) -> форма мокапа (camelCase)
  // ------------------------------------------------------------------
  const M = {
    product: (p) => ({
      id: p.id, sku: p.sku, name: p.name, cat: p.category_id, brand: p.brand, unit: p.unit,
      priceCost: p.price_cost, priceWholesale: p.price_wholesale, priceRetail: p.price_retail,
      stock: p.stock ?? 0, reserved: p.reserved ?? 0, image: p.image || '',
    }),
    client: (c) => ({
      id: c.id, name: c.name, bin: c.bin, type: c.type_key, contact: c.contact, phone: c.phone,
      email: c.email, city: c.city, address: c.address, manager: c.manager_id,
      balance: c.balance, ltv: c.ltv, lastDeal: c.last_deal, tags: c.tags || [],
    }),
    deal: (d) => ({
      id: d.id, no: d.no, title: d.title, client: d.client_id, manager: d.manager_id,
      coManager: d.co_manager_id, comments: d.comments, address: d.address,
      stage: d.stage_id, amount: d.amount, items: d.items, created: d.created, target: d.target,
      lineItems: (d.lineItems || []).map((it) => ({ product: it.product_id, qty: it.qty, priceUsed: it.price_used })),
    }),
    user: (u, rolesByKey) => ({
      id: u.id, name: u.name, email: u.email, roleKey: u.role_key,
      role: (rolesByKey[u.role_key] && rolesByKey[u.role_key].label) || u.role_key,
      phone: u.phone, avatar: u.avatar, color: u.color, active: u.active !== 0,
    }),
    supplier: (s) => ({
      id: s.id, name: s.name, contact: s.contact, phone: s.phone, email: s.email,
      share: s.share, lastDelivery: s.last_delivery, note: s.note,
    }),
    task: (t) => ({
      id: t.id, title: t.title, due: t.due, owner: t.owner_id, deal: t.deal_id,
      priority: t.priority_id, done: !!t.done,
      description: t.description || '', startDate: t.start_date || '',
      status: t.status || (t.done ? 'done' : 'new'), comments: t.comments || '',
    }),
    invoice: (i) => ({
      id: i.id, no: i.no, deal: i.deal_id, client: i.client_id, date: i.date,
      amount: i.amount, status: i.status_id, due: i.due,
    }),
    shipment: (s) => ({
      id: s.id, no: s.no, deal: s.deal_id, client: s.client_id, date: s.date, items: s.items,
      weight: s.weight, transport: s.transport, driver: s.driver, status: s.status_id, destination: s.destination,
    }),
    receipt: (r) => ({
      id: r.id, no: r.no, supplier: r.supplier_id, supplierName: r.supplier_name, date: r.date, items: r.items,
      amount: r.amount, status: r.status, note: r.note,
    }),
    notification: (n) => ({ id: n.id, text: n.text, type: n.type, time: n.created_at || '' }),
  };

  // Обратный маппинг (форма мокапа -> тело для API). Пустые поля не шлём.
  const toApi = {
    product: (p) => clean({
      id: p.id, sku: p.sku, name: p.name, category_id: p.cat, brand: p.brand, unit: p.unit,
      price_cost: p.priceCost, price_wholesale: p.priceWholesale, price_retail: p.priceRetail,
      image: p.image,
    }),
    client: (c) => clean({
      id: c.id, name: c.name, bin: c.bin, type_key: c.type, contact: c.contact, phone: c.phone,
      email: c.email, city: c.city, address: c.address, manager_id: c.manager,
      balance: c.balance, ltv: c.ltv, last_deal: c.lastDeal, tags: c.tags,
    }),
    deal: (d) => clean({
      id: d.id, no: d.no, title: d.title, client_id: d.client, manager_id: d.manager,
      co_manager_id: d.coManager, comments: d.comments, address: d.address,
      stage_id: d.stage, amount: d.amount, created: d.created, target: d.target,
    }),
    // позиции сделки шлём отдельно (только когда редактируем состав)
    dealItems: (arr) => (arr || []).map((it) => ({ product_id: it.product, qty: it.qty, price_used: it.priceUsed })),
    lead: (l) => clean({
      id: l.id, source: l.source, name: l.name, phone: l.phone,
      subject: l.subject, status_id: l.status, created: l.created,
    }),
    supplier: (s) => clean({
      id: s.id, name: s.name, contact: s.contact, phone: s.phone, email: s.email,
      share: s.share, last_delivery: s.lastDelivery, note: s.note,
    }),
    task: (t) => clean({
      id: t.id, title: t.title, due: t.due, owner_id: t.owner, deal_id: t.deal,
      priority_id: t.priority, done: (t.status === 'done' || t.done) ? 1 : 0,
      description: t.description, start_date: t.startDate, status: t.status, comments: t.comments,
    }),
    invoice: (i) => clean({
      id: i.id, no: i.no, deal_id: i.deal, client_id: i.client, date: i.date,
      amount: i.amount, status_id: i.status, due: i.due,
    }),
    shipment: (s) => clean({
      id: s.id, no: s.no, deal_id: s.deal, client_id: s.client, date: s.date, items: s.items,
      weight: s.weight, transport: s.transport, driver: s.driver, status_id: s.status, destination: s.destination,
    }),
  };
  function clean(o) { const r = {}; for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; }

  // ------------------------------------------------------------------
  // Справочники -> структуры, совместимые со STAGES/ROLES/CLIENT_TYPES
  // ------------------------------------------------------------------
  function buildRoles(rows) {
    const out = {};
    for (const r of rows) {
      let modules = [], canEdit = {};
      try { modules = JSON.parse(r.modules || '[]'); } catch {}
      try { canEdit = JSON.parse(r.can_edit || '{}'); } catch {}
      out[r.key] = { label: r.label, color: r.color, modules, canEdit, seeAllData: r.see_all_data === 1 };
    }
    return out;
  }
  const buildStages = (rows) => rows.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((s) => ({ id: s.id, label: s.label, color: s.color, sort: s.sort, pipelineId: s.pipeline_id || 'default' }));
  const buildPipelines = (rows) => (rows || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((p) => ({ id: p.id, name: p.name, sort: p.sort }));
  function buildClientTypes(rows) {
    const out = {}; for (const t of rows) out[t.key] = { label: t.label, color: t.color }; return out;
  }

  // ------------------------------------------------------------------
  // Полная загрузка состояния (форма как у SEED) одним заходом
  // ------------------------------------------------------------------
  async function loadAllData() {
    // отметить просроченные задачи и разослать уведомления (директор + ответственный)
    try { await apiFetch('notifications/scan-overdue', { method: 'POST' }); } catch (e) {}
    const [
      company, rolesRows, stagesRows, pipelinesRows, typesRows, cats, leadSources, leadStatuses,
      warehouses, shipStatuses, invStatuses, taskPrios,
      usersRows, suppliers, productsResp, clients, deals, leads, tasks, invoices, shipments, receipts, notifications,
    ] = await Promise.all([
      apiFetch('company'), apiFetch('roles'), apiFetch('deal_stages'), apiFetch('pipelines'), apiFetch('client_types'),
      apiFetch('product_categories'), apiFetch('lead_sources'), apiFetch('lead_statuses'),
      apiFetch('warehouses'), apiFetch('shipment_statuses'), apiFetch('invoice_statuses'), apiFetch('task_priorities'),
      apiFetch('users'), apiFetch('suppliers'), apiFetch('products?limit=1000'), apiFetch('clients?limit=1000'),
      apiFetch('deals'), apiFetch('leads'), apiFetch('tasks'), apiFetch('invoices'), apiFetch('shipments'),
      apiFetch('receipts'), apiFetch('notifications'),
    ]);

    const rolesByKey = buildRoles(rolesRows);
    const srcById = {}; (leadSources || []).forEach((s) => { srcById[s.id] = s.name; });
    const meta = (Array.isArray(company) ? company[0] : company) || {};
    const products = (productsResp.data || productsResp || []).map(M.product);

    // категории + пересчёт count по товарам (в мокапе показывался count)
    const catCount = {}; products.forEach((p) => { catCount[p.cat] = (catCount[p.cat] || 0) + 1; });
    const categories = (cats || []).map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: catCount[c.id] || 0 }));

    const state = {
      meta: { tenant: meta.tenant, city: meta.city, currency: meta.currency || '₸', version: 1 },
      users: (usersRows || []).map((u) => M.user(u, rolesByKey)),
      categories,
      products,
      clients: (clients || []).map(M.client),
      deals: (deals || []).map(M.deal),               // lineItems подгружаются лениво в карточке сделки
      leads: (leads || []).map((l) => ({ id: l.id, source: srcById[l.source_id] || '', name: l.name, phone: l.phone, subject: l.subject, created: l.created, status: l.status_id })),
      suppliers: (suppliers || []).map(M.supplier),
      tasks: (tasks || []).map(M.task),
      invoices: (invoices || []).map(M.invoice),
      shipments: (shipments || []).map(M.shipment),
      receipts: (receipts || []).map(M.receipt),
      notifications: (notifications || []).map(M.notification),
    };

    // справочники, которыми пользуется app.js напрямую
    const dict = {
      STAGES: buildStages(stagesRows),
      PIPELINES: buildPipelines(pipelinesRows),
      ROLES: rolesByKey,
      CLIENT_TYPES: buildClientTypes(typesRows),
    };
    return { state, dict };
  }

  // Подгрузка позиций конкретной сделки (для карточки сделки)
  async function loadDeal(id) { return M.deal(await apiFetch('deals/' + encodeURIComponent(id))); }

  // Загрузка файла в R2 (multipart). Возвращает { key, url, size, type }.
  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    const tok = getToken();
    if (tok) headers['authorization'] = 'Bearer ' + tok;
    const res = await fetch('/api/files', { method: 'POST', headers, body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((data && data.error) || ('HTTP ' + res.status));
      e.status = res.status;
      throw e;
    }
    return data;
  }

  window.__API__ = {
    apiFetch, login, logout, isAuthed, getToken, clearToken,
    loadAllData, loadDeal, uploadFile, map: M, toApi,
  };
})();
