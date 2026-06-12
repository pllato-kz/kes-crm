// KES CRM — рендер, навигация, авторизация. SPA на чистом JS.

// Слой 4: данные приходят из боевого API (api.js), а не из localStorage.
let { STAGES, ROLES, CLIENT_TYPES } = window.__KES__; // переопределяются из БД в loadData()
const { saveState, resetState } = window.__KES__;
let state = { meta: {}, users: [], categories: [], products: [], clients: [], deals: [], leads: [], suppliers: [], tasks: [], invoices: [], shipments: [], receipts: [], notifications: [] };
let currentUser = null; // заполняется после логина

// ---------- Утилиты ----------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
};

const fmtMoney = (n) => {
  if (n == null) return '—';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(Math.round(n));
  return sign + abs.toLocaleString('ru-RU') + ' ₸';
};
const fmtMoneyK = (n) => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0','') + ' млн ₸';
  if (Math.abs(n) >= 1_000) return Math.round(n / 1000) + ' тыс ₸';
  return n + ' ₸';
};
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const byId = (arr, id) => arr.find(x => x.id === id);
const stageById = (id) => STAGES.find(s => s.id === id) || STAGES[0];
const userById = (id) => byId(state.users, id) || { name: '—', avatar: '?', color: '#999' };
const clientById = (id) => byId(state.clients, id) || { name: '—' };
const categoryById = (id) => byId(state.categories, id) || { name: '—', icon: '·' };

// ---------- Роутер ----------
const VIEWS = {};
const ROUTES = [
  'dashboard','leads','deals','clients','catalog','warehouse',
  'shipments','invoices','suppliers','tasks','reports','settings'
];

function navigate(view, params = {}) {
  if (!ROUTES.includes(view)) view = 'dashboard';
  // Гейт прав: если у роли нет этого модуля — показываем заглушку «нет доступа»
  if (currentUser && !can('see-module', view)) {
    const main = $('#main');
    if (main) {
      main.innerHTML = '';
      main.append(el('div', { class: 'no-access' }, [
        el('div', { class: 'lock-icon' }, '🔒'),
        el('h2', {}, 'Нет доступа'),
        el('div', {}, `Роль «${role().label}» не имеет доступа к разделу.`),
        el('button', { class: 'btn btn-primary', style: 'margin-top:12px', onclick: () => navigate(role().modules[0]) }, '← Назад'),
      ]));
    }
    $('#page-title') && ($('#page-title').textContent = 'Нет доступа');
    return;
  }
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  // Берём текстовое содержимое кнопки, отбрасываем emoji-иконку и badge с числом
  const btn = $(`#nav button[data-view="${view}"]`);
  let label = view;
  if (btn) {
    label = Array.from(btn.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
  }
  $('#page-title').textContent = label || view;
  const main = $('#main');
  main.innerHTML = '';
  const renderer = VIEWS[view] || VIEWS.dashboard;
  main.append(renderer(params));
}

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('#nav button[data-view]');
  if (navBtn) { navigate(navBtn.dataset.view); document.body.classList.remove('nav-open'); return; }
  const navLink = e.target.closest('[data-nav]');
  if (navLink) {
    e.preventDefault();
    navigate(navLink.dataset.nav, JSON.parse(navLink.dataset.params || '{}'));
    document.body.classList.remove('nav-open');
  }
});

// ---------- Toast ----------
function toast(text, type = 'info', icon = null) {
  const stack = $('#toasts');
  if (!stack) { console.log('[toast]', text); return; }
  const iconMap = { info: 'ℹ️', success: '✓', warn: '⚠️', error: '✗' };
  const t = el('div', { class: 'toast ' + type }, [
    el('span', { class: 'toast-icon' }, icon || iconMap[type] || ''),
    el('span', {}, text),
  ]);
  stack.append(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; }, 2400);
  setTimeout(() => t.remove(), 2700);
}

// ---------- Stub (informative modal for actions that will be in production) ----------
function stub(title, description, bullets = []) {
  const body = el('div', { class: 'stub-body' }, [
    el('span', { class: 'stub-icon' }, '🚧'),
    el('p', {}, description),
    bullets.length
      ? el('ul', { class: 'stub-list' }, bullets.map(b => el('li', {}, b)))
      : null,
    el('p', { style: 'margin-top:14px;font-size:12px;color:#9CA3AF' },
      'Это мокап — действие появится после подключения бэка (Cloudflare Worker + D1).'),
  ]);
  openModal({
    title,
    body,
    foot: [el('button', { class: 'btn btn-primary', onclick: closeModal }, 'Понятно')],
  });
}

// ---------- Modal ----------
function openModal({ title, body, foot = [] }) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = '';
  $('#modal-body').append(body);
  $('#modal-foot').innerHTML = '';
  foot.forEach(b => $('#modal-foot').append(b));
  $('#modal').classList.add('show');
}
function closeModal() { const m = $('#modal'); if (m) m.classList.remove('show'); }
// Делегированные обработчики через document — переживают перерисовку body
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-close') closeModal();
  if (e.target.id === 'modal') closeModal();
});

// ============================================================
// FORM HELPERS — компактные конструкторы полей
// ============================================================
function fInput(label, value = '', { type = 'text', placeholder = '' } = {}) {
  const inp = el('input', { type, value, placeholder });
  return { row: el('div', { class: 'form-row' }, [el('label', {}, label), inp]), get: () => inp.value };
}
function fSelect(label, options, value) {
  const sel = el('select');
  options.forEach(o => {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  });
  return { row: el('div', { class: 'form-row' }, [el('label', {}, label), sel]), get: () => sel.value };
}
function fTextarea(label, value = '') {
  const ta = el('textarea', { rows: 3 });
  ta.value = value;
  return { row: el('div', { class: 'form-row' }, [el('label', {}, label), ta]), get: () => ta.value };
}

// ---------- New Client ----------
// ============================================================
// ИМПОРТ из XLSX/CSV (прайс EKF, клиенты)
// ============================================================
function aoaToRows(aoa) {
  if (!aoa || !aoa.length) return { headers: [], rows: [] };
  const headers = aoa[0].map(h => String(h == null ? '' : h).trim());
  const rows = aoa.slice(1).map(arr => { const o = {}; headers.forEach((h, i) => { o[h] = arr[i]; }); return o; });
  return { headers, rows };
}
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const lines = []; let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { cur.push(field); field = ''; }
    else if (ch === '\n') { cur.push(field); lines.push(cur); cur = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length || cur.length) { cur.push(field); lines.push(cur); }
  return aoaToRows(lines.filter(r => r.some(c => String(c).trim() !== '')));
}
function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const name = (file.name || '').toLowerCase();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      reader.onload = () => { try { resolve(parseCSV(reader.result)); } catch (e) { reject(e); } };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = () => {
        try {
          if (!window.XLSX) { reject(new Error('Библиотека XLSX не загрузилась')); return; }
          const wb = window.XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
          resolve(aoaToRows(aoa));
        } catch (e) { reject(e); }
      };
      reader.readAsArrayBuffer(file);
    }
  });
}
async function runPool(items, worker, concurrency = 6) {
  let i = 0;
  const next = async () => { while (i < items.length) { const idx = i++; await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, next));
}

const IMPORT_CONFIGS = {
  products: {
    title: 'Импорт прайса EKF',
    note: 'XLSX или CSV. Первая строка — заголовки. Существующие товары обновляются по артикулу (SKU), новые — добавляются.',
    fields: [
      { key: 'sku',            label: 'Артикул (SKU)', match: /артикул|sku|код/i, required: true },
      { key: 'name',           label: 'Наименование',  match: /наимен|назван|товар|name/i, required: true },
      { key: 'brand',          label: 'Бренд',         match: /бренд|brand|производ/i },
      { key: 'priceCost',      label: 'Закуп',         match: /закуп|себест|cost/i, num: true },
      { key: 'priceWholesale', label: 'Опт',           match: /опт|wholesale/i, num: true },
      { key: 'priceRetail',    label: 'Розница',       match: /розн|retail|цена/i, num: true },
      { key: 'stock',          label: 'Остаток',       match: /остаток|stock|qty|кол-?во/i, num: true },
    ],
    run: importProducts,
  },
  clients: {
    title: 'Импорт клиентов',
    note: 'XLSX или CSV. Первая строка — заголовки. Дубли по БИН пропускаются.',
    fields: [
      { key: 'name',    label: 'Наименование', match: /наимен|назван|клиент|компан|name/i, required: true },
      { key: 'bin',     label: 'БИН/ИИН',      match: /бин|иин|bin/i },
      { key: 'type',    label: 'Тип',          match: /тип|type/i },
      { key: 'contact', label: 'Контакт',      match: /контакт|contact|лицо/i },
      { key: 'phone',   label: 'Телефон',      match: /телефон|phone|тел/i },
      { key: 'email',   label: 'Email',        match: /e-?mail|почта/i },
      { key: 'city',    label: 'Город',        match: /город|city/i },
      { key: 'address', label: 'Адрес',        match: /адрес|address/i },
    ],
    run: importClients,
  },
};

function openImport(kind) {
  const cfg = IMPORT_CONFIGS[kind];
  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  const host = el('div', { style: 'margin-top:12px' });
  let parsed = null;

  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    host.innerHTML = ''; host.append(el('div', { class: 'muted' }, 'Читаю файл…'));
    try {
      const { headers, rows } = await parseSpreadsheet(f);
      if (!rows.length) { host.innerHTML = ''; host.append(el('div', { class: 'pill pill-danger' }, 'В файле нет строк данных')); parsed = null; return; }
      const mapping = {};
      cfg.fields.forEach(fld => { const h = headers.find(hh => fld.match.test(hh)); if (h) mapping[fld.key] = h; });
      parsed = { headers, rows, mapping };
      renderMapping();
    } catch (e) { host.innerHTML = ''; host.append(el('div', { class: 'pill pill-danger' }, 'Ошибка чтения: ' + (e.message || e))); parsed = null; }
  };

  function renderMapping() {
    host.innerHTML = '';
    const { headers, rows, mapping } = parsed;
    host.append(el('div', { style: 'font-weight:600;margin-bottom:8px' }, `Строк в файле: ${rows.length}. Сопоставьте колонки:`));
    const grid = el('div', { class: 'grid grid-2', style: 'gap:8px 14px' });
    cfg.fields.forEach(fld => {
      const sel = el('select', { onchange: e => { mapping[fld.key] = e.target.value || null; } },
        [el('option', { value: '' }, '— нет —')].concat(headers.map(h => {
          const o = el('option', { value: h }, h); if (mapping[fld.key] === h) o.selected = true; return o;
        })));
      grid.append(el('div', {}, [el('label', { style: 'font-size:11px;color:#6B7280;display:block' }, fld.label + (fld.required ? ' *' : '')), sel]));
    });
    host.append(grid);
  }

  openModal({
    title: cfg.title,
    body: el('div', {}, [
      el('p', { class: 'muted', style: 'margin-top:0' }, cfg.note),
      fileInput,
      host,
    ]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!parsed) { toast('Выберите файл', 'warn'); return; }
        const missing = cfg.fields.filter(f => f.required && !parsed.mapping[f.key]);
        if (missing.length) { toast('Сопоставьте: ' + missing.map(f => f.label).join(', '), 'warn'); return; }
        const entities = parsed.rows.map(r => {
          const o = {};
          cfg.fields.forEach(fld => {
            const h = parsed.mapping[fld.key]; if (!h) return;
            let v = r[h]; if (v == null) return;
            v = String(v).trim(); if (v === '') return;
            if (fld.num) v = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0;
            o[fld.key] = v;
          });
          return o;
        }).filter(o => cfg.fields.every(f => !f.required || (o[f.key] != null && o[f.key] !== '')));
        if (!entities.length) { toast('Нет валидных строк (проверьте обязательные колонки)', 'warn'); return; }
        closeModal();
        await cfg.run(entities);
      } }, 'Импортировать'),
    ],
  });
}

async function importProducts(rows) {
  const bySku = {}; state.products.forEach(p => { bySku[p.sku] = p; });
  let created = 0, updated = 0, failed = 0;
  toast(`Импорт ${rows.length} позиций…`, 'info');
  await runPool(rows, async (r) => {
    try {
      const existing = bySku[r.sku];
      const body = window.__API__.toApi.product({ sku: r.sku, name: r.name, brand: r.brand, priceCost: r.priceCost, priceWholesale: r.priceWholesale, priceRetail: r.priceRetail });
      if (existing) {
        delete body.id;
        await window.__API__.apiFetch('products/' + existing.id, { method: 'PUT', body });
        Object.assign(existing, { name: r.name != null ? r.name : existing.name, brand: r.brand != null ? r.brand : existing.brand, priceCost: r.priceCost != null ? r.priceCost : existing.priceCost, priceWholesale: r.priceWholesale != null ? r.priceWholesale : existing.priceWholesale, priceRetail: r.priceRetail != null ? r.priceRetail : existing.priceRetail });
        if (r.stock != null) { await window.__API__.apiFetch('products/' + existing.id + '/stock', { method: 'PUT', body: { stock: r.stock, reserved: existing.reserved || 0 } }); existing.stock = r.stock; }
        updated++;
      } else {
        const saved = await window.__API__.apiFetch('products', { method: 'POST', body });
        const mp = window.__API__.map.product(saved);
        if (r.stock != null) { await window.__API__.apiFetch('products/' + saved.id + '/stock', { method: 'PUT', body: { stock: r.stock, reserved: 0 } }); mp.stock = r.stock; }
        state.products.unshift(mp); bySku[mp.sku] = mp;
        created++;
      }
    } catch (e) { failed++; }
  });
  toast(`Прайс импортирован: +${created} новых, ${updated} обновлено${failed ? ', ' + failed + ' ошибок' : ''}`, failed ? 'warn' : 'success');
  navigate('catalog');
}

async function importClients(rows) {
  const byBin = {}; state.clients.forEach(c => { if (c.bin) byBin[c.bin] = c; });
  let created = 0, skipped = 0, failed = 0;
  toast(`Импорт ${rows.length} клиентов…`, 'info');
  for (const r of rows) {
    try {
      if (r.bin && byBin[r.bin]) { skipped++; continue; }
      const tv = (r.type || '').toString().toLowerCase();
      const type = /розн|rozn/.test(tv) ? 'rozn' : /дилер|dilr|dealer/.test(tv) ? 'dilr' : 'opt';
      const c = { name: r.name, bin: r.bin || '', type, contact: r.contact || '', phone: r.phone || '', email: r.email || '—', city: r.city || '', address: r.address || '', balance: 0, ltv: 0, lastDeal: new Date().toISOString().slice(0, 10), tags: ['импорт'] };
      const saved = await window.__API__.apiFetch('clients', { method: 'POST', body: window.__API__.toApi.client(c) });
      const mc = window.__API__.map.client(saved); state.clients.unshift(mc); if (mc.bin) byBin[mc.bin] = mc;
      created++;
    } catch (e) { failed++; }
  }
  toast(`Клиенты импортированы: +${created} новых, ${skipped} пропущено (дубль БИН)${failed ? ', ' + failed + ' ошибок' : ''}`, failed ? 'warn' : 'success');
  navigate('clients');
}

// Скачивание файла в браузере
function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

// Экспорт клиентов в CSV (реальное скачивание)
function exportClientsCSV() {
  const list = visibleClients();
  if (!list.length) { toast('Нет клиентов для экспорта', 'warn'); return; }
  const cols = [
    ['Наименование', c => c.name],
    ['БИН', c => c.bin],
    ['Тип', c => (CLIENT_TYPES[c.type] || {}).label || c.type],
    ['Контакт', c => c.contact],
    ['Телефон', c => c.phone],
    ['Email', c => c.email],
    ['Город', c => c.city],
    ['Адрес', c => c.address],
    ['Баланс', c => c.balance],
    ['Оборот (LTV)', c => c.ltv],
    ['Менеджер', c => userById(c.manager).name],
    ['Теги', c => (c.tags || []).join(', ')],
  ];
  const esc = (v) => { v = v == null ? '' : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [cols.map(c => c[0]).join(';')];
  list.forEach(c => lines.push(cols.map(col => esc(col[1](c))).join(';')));
  const csv = '﻿' + lines.join('\r\n'); // BOM — чтобы Excel понял UTF-8
  downloadFile('clients-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
  toast(`Экспортировано клиентов: ${list.length}`, 'success');
}

function openNewClient() {
  const name    = fInput('Наименование (ТОО / ИП)', '', { placeholder: 'ТОО «Название»' });
  const bin     = fInput('БИН/ИИН (12 цифр)', '', { placeholder: '000000000000' });
  const type    = fSelect('Тип', [
    { value: 'opt',  label: 'Опт' },
    { value: 'rozn', label: 'Розница' },
    { value: 'dilr', label: 'Дилер' },
  ], 'opt');
  const contact = fInput('Контактное лицо');
  const phone   = fInput('Телефон', '', { placeholder: '+7 7XX XXX XX XX' });
  const email   = fInput('Email');
  const city    = fInput('Город', 'Караганда');
  const address = fInput('Адрес');
  const manager = fSelect('Менеджер',
    state.users.filter(u => u.role.includes('Менеджер')).map(u => ({ value: u.id, label: u.name })),
    state.users[0].id);

  const form = el('div', {}, [name.row, bin.row, type.row, contact.row, phone.row, email.row, city.row, address.row, manager.row]);
  openModal({
    title: 'Новый клиент',
    body: form,
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!name.get().trim()) { toast('Введите наименование', 'warn'); return; }
        const c = {
          name: name.get().trim(), bin: bin.get(), type: type.get(),
          contact: contact.get(), phone: phone.get(), email: email.get() || '—',
          city: city.get(), address: address.get(), manager: manager.get(),
          balance: 0, ltv: 0, lastDeal: new Date().toISOString().slice(0,10), tags: ['новый'],
        };
        try {
          const saved = await window.__API__.apiFetch('clients', { method: 'POST', body: window.__API__.toApi.client(c) });
          state.clients.unshift(window.__API__.map.client(saved));
          closeModal(); toast('Клиент добавлен', 'success'); navigate('clients');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать клиента'),
    ],
  });
}

// ---------- New Lead ----------
function openNewLead() {
  const src   = fSelect('Источник', ['Сайт','Звонок','WhatsApp','Telegram','Email'].map(v => ({ value: v, label: v })), 'Сайт');
  const name  = fInput('Имя / Компания');
  const phone = fInput('Телефон', '', { placeholder: '+7 7XX XXX XX XX' });
  const sub   = fTextarea('Тема обращения');
  openModal({
    title: 'Новая заявка',
    body: el('div', {}, [src.row, name.row, phone.row, sub.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!name.get().trim()) { toast('Введите имя', 'warn'); return; }
        const now = new Date();
        const ts = now.toISOString().slice(0,10) + ' ' + now.toTimeString().slice(0,5);
        const ld = { source: src.get(), name: name.get().trim(), phone: phone.get(), subject: sub.get(), created: ts, status: 'new' };
        try {
          const saved = await window.__API__.apiFetch('leads', { method: 'POST', body: window.__API__.toApi.lead(ld) });
          state.leads.unshift({ id: saved.id, source: ld.source, name: ld.name, phone: ld.phone, subject: ld.subject, created: saved.created || ts, status: saved.status_id || 'new' });
          closeModal(); toast('Заявка зарегистрирована', 'success'); navigate('leads');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать'),
    ],
  });
}

// ---------- Convert Lead → Deal ----------
function convertLead(id) {
  const l = byId(state.leads, id);
  if (!l) return;
  const name  = fInput('Название сделки', l.subject);
  const client = fSelect('Клиент (из существующих)',
    [{ value: '', label: '— Создать нового позже —' }].concat(state.clients.map(c => ({ value: c.id, label: c.name }))),
    '');
  const amount = fInput('Сумма, ₸', '', { type: 'number', placeholder: '0' });
  const mgr = fSelect('Менеджер',
    state.users.filter(u => u.role.includes('Менеджер')).map(u => ({ value: u.id, label: u.name })),
    state.users[0].id);

  openModal({
    title: 'Конвертация заявки → Сделка',
    body: el('div', {}, [
      el('div', { class: 'pill pill-info', style: 'margin-bottom:14px' }, `Источник: ${l.source} · ${l.name}`),
      name.row, client.row, amount.row, mgr.row,
    ]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const today = new Date().toISOString().slice(0,10);
        const num = state.deals.length + 160;
        const nd = { no: '2026-0' + num, client: client.get() || state.clients[0].id, manager: mgr.get(), stage: 'new', amount: Number(amount.get()) || 0, items: 0, created: today, target: today, title: name.get().trim() || l.subject };
        try {
          const saved = await window.__API__.apiFetch('deals', { method: 'POST', body: window.__API__.toApi.deal(nd) });
          state.deals.unshift(window.__API__.map.deal(saved));
          await window.__API__.apiFetch('leads/' + l.id, { method: 'PUT', body: { status_id: 'converted' } });
          l.status = 'converted';
          closeModal(); toast('Заявка → Сделка создана', 'success'); navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать сделку'),
    ],
  });
}

// ---------- New Task ----------
function openNewTask() {
  const title = fInput('Что сделать');
  const owner = fSelect('Ответственный',
    state.users.map(u => ({ value: u.id, label: u.name + ' · ' + u.role })),
    state.users[0].id);
  const due = fInput('Срок', new Date().toISOString().slice(0,10) + ' 18:00');
  const prio = fSelect('Приоритет',
    [{value:'low',label:'низкий'},{value:'medium',label:'средний'},{value:'high',label:'высокий'}],
    'medium');
  openModal({
    title: 'Новая задача',
    body: el('div', {}, [title.row, owner.row, due.row, prio.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!title.get().trim()) { toast('Введите задачу', 'warn'); return; }
        const t = { title: title.get().trim(), due: due.get(), owner: owner.get(), deal: null, done: false, priority: prio.get() };
        try {
          const saved = await window.__API__.apiFetch('tasks', { method: 'POST', body: window.__API__.toApi.task(t) });
          state.tasks.unshift(window.__API__.map.task(saved));
          closeModal(); toast('Задача добавлена', 'success'); navigate('tasks');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать'),
    ],
  });
}

// ---------- New Product ----------
function openNewProduct() {
  const sku  = fInput('Артикул (SKU)', '', { placeholder: 'mcb-xxxx' });
  const name = fInput('Наименование');
  const cat  = fSelect('Категория', state.categories.map(c => ({ value: c.id, label: c.name })), state.categories[0].id);
  const brand = fInput('Бренд', 'EKF');
  const unit = fSelect('Ед.', [{value:'шт',label:'шт'},{value:'м',label:'м'},{value:'кг',label:'кг'},{value:'упак',label:'упак'}], 'шт');
  const pc = fInput('Закупочная, ₸', '', { type: 'number' });
  const pw = fInput('Оптовая, ₸', '', { type: 'number' });
  const pr = fInput('Розничная, ₸', '', { type: 'number' });
  const st = fInput('Остаток', '0', { type: 'number' });
  openModal({
    title: 'Новый товар',
    body: el('div', {}, [sku.row, name.row, cat.row, brand.row, unit.row, pc.row, pw.row, pr.row, st.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!sku.get() || !name.get()) { toast('Заполните артикул и название', 'warn'); return; }
        const p = { sku: sku.get(), name: name.get(), cat: cat.get(), brand: brand.get(), unit: unit.get(), priceCost: +pc.get()||0, priceWholesale: +pw.get()||0, priceRetail: +pr.get()||0 };
        const stockVal = +st.get()||0;
        try {
          const saved = await window.__API__.apiFetch('products', { method: 'POST', body: window.__API__.toApi.product(p) });
          if (stockVal) await window.__API__.apiFetch('products/' + saved.id + '/stock', { method: 'PUT', body: { stock: stockVal, reserved: 0 } });
          state.products.unshift({ ...window.__API__.map.product(saved), stock: stockVal, reserved: 0 });
          closeModal(); toast('Товар добавлен', 'success'); navigate('catalog');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Добавить товар'),
    ],
  });
}

// ---------- New Supplier ----------
function openNewSupplier() {
  const name = fInput('Название');
  const contact = fInput('Контакт');
  const phone = fInput('Телефон');
  const email = fInput('Email');
  const note = fTextarea('Примечание');
  openModal({
    title: 'Новый поставщик',
    body: el('div', {}, [name.row, contact.row, phone.row, email.row, note.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!name.get().trim()) { toast('Введите название', 'warn'); return; }
        const sp = { name: name.get().trim(), contact: contact.get(), phone: phone.get(), email: email.get(), share: 0, lastDelivery: new Date().toISOString().slice(0,10), note: note.get() };
        try {
          const saved = await window.__API__.apiFetch('suppliers', { method: 'POST', body: window.__API__.toApi.supplier(sp) });
          state.suppliers.push(window.__API__.map.supplier(saved));
          closeModal(); toast('Поставщик добавлен', 'success'); navigate('suppliers');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать'),
    ],
  });
}

// ---------- New Shipment ----------
function openNewShipment() {
  const deal = fSelect('Сделка',
    state.deals.filter(d => ['paid','agreed','invoice'].includes(d.stage)).map(d => ({ value: d.id, label: '№' + d.no + ' · ' + d.title })),
    null);
  const date = fInput('Дата', new Date().toISOString().slice(0,10), { type: 'date' });
  const transport = fSelect('Транспорт',
    ['Газель собственная','Самовывоз','Транспортная Astana Trans','Курьер','Other'].map(v => ({ value: v, label: v })),
    'Газель собственная');
  const driver = fInput('Водитель', 'Куаныш А.');
  const dest = fInput('Адрес доставки');
  openModal({
    title: 'Новая отгрузка',
    body: el('div', {}, [deal.row, date.row, transport.row, driver.row, dest.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const d = byId(state.deals, deal.get());
        const sh = {
          no: 'ТТН-0' + (515 + state.shipments.length),
          deal: deal.get(), client: (d && d.client) || (state.clients[0] && state.clients[0].id),
          date: date.get(), items: (d && d.items) || 1, weight: 0,
          transport: transport.get(), driver: driver.get(), status: 'planned', destination: dest.get(),
        };
        try {
          const saved = await window.__API__.apiFetch('shipments', { method: 'POST', body: window.__API__.toApi.shipment(sh) });
          state.shipments.unshift(window.__API__.map.shipment(saved));
          closeModal(); toast('Отгрузка запланирована', 'success'); navigate('shipments');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать'),
    ],
  });
}

// ---------- New Invoice (document) ----------
function openNewInvoice() {
  const deal = fSelect('По сделке',
    state.deals.map(d => ({ value: d.id, label: '№' + d.no + ' · ' + clientById(d.client).name })),
    state.deals[0]?.id);
  const amount = fInput('Сумма, ₸', '', { type: 'number' });
  const due = fInput('Срок оплаты', '', { type: 'date' });
  openModal({
    title: 'Новый счёт',
    body: el('div', {}, [deal.row, amount.row, due.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const d = byId(state.deals, deal.get());
        const iv = {
          no: 'СФ-2026-0' + (240 + state.invoices.length),
          deal: deal.get(), client: d && d.client, date: new Date().toISOString().slice(0,10),
          amount: +amount.get() || 0, status: 'pending', due: due.get(),
        };
        try {
          const saved = await window.__API__.apiFetch('invoices', { method: 'POST', body: window.__API__.toApi.invoice(iv) });
          state.invoices.unshift(window.__API__.map.invoice(saved));
          closeModal(); toast('Счёт выставлен', 'success'); navigate('invoices');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Выставить'),
    ],
  });
}

// ============================================================
// DETAIL MODALS — продукт / отгрузка / счёт / поставщик / уведомления
// ============================================================
function openProductDetail(idOrProduct) {
  const p = (idOrProduct && typeof idOrProduct === 'object') ? idOrProduct : byId(state.products, idOrProduct);
  if (!p) return;
  const cat = categoryById(p.cat);
  const free = p.stock - p.reserved;
  const margin = (p.priceCost > 0 && p.priceRetail > 0)
    ? Math.round((p.priceRetail - p.priceCost) / p.priceCost * 100) + '%'
    : '—';

  // Фото товара (R2) + загрузка
  const imgHost = el('div', { style:'margin-bottom:14px' });
  const fileInput = el('input', { type:'file', accept:'image/*', style:'display:none' });
  function renderImg() {
    imgHost.innerHTML = '';
    if (p.image) {
      imgHost.append(el('img', { src: p.image, alt: p.name, style:'width:100%;max-height:220px;object-fit:contain;background:#F4F5F7;border-radius:8px;border:1px solid #E5E7EB' }));
    } else {
      imgHost.append(el('div', { style:'height:120px;display:flex;align-items:center;justify-content:center;background:#F4F5F7;border:1px dashed #D1D5DB;border-radius:8px;color:#9CA3AF;font-size:13px' }, 'Фото нет'));
    }
    if (can('edit-stock')) {
      imgHost.append(fileInput, el('button', { class:'btn btn-sm', style:'margin-top:8px', onclick: () => fileInput.click() }, p.image ? '🖼 Заменить фото' : '🖼 Загрузить фото'));
    }
  }
  fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    toast('Загрузка фото…', 'info');
    try {
      const up = await window.__API__.uploadFile(f);
      await window.__API__.apiFetch('products/' + p.id, { method: 'PUT', body: { image: up.url } });
      p.image = up.url;
      renderImg();
      toast('Фото загружено', 'success');
    } catch (e) { toast('Ошибка загрузки: ' + ((e && e.message) || e), 'error'); }
  };
  renderImg();

  openModal({
    title: p.name,
    body: el('div', {}, [
      imgHost,
      el('div', { class:'row', style:'gap:10px;margin-bottom:14px' }, [
        el('span', { class:'tag' }, p.sku),
        el('span', { class:'tag' }, cat.icon + ' ' + cat.name),
        el('span', { class:'tag' }, p.brand),
      ]),
      el('div', { class:'grid grid-3', style:'gap:10px;margin-bottom:14px' }, [
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Закуп'), el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, p.priceCost ? fmtMoney(p.priceCost) : '—')]),
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Опт'),   el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, p.priceWholesale ? fmtMoney(p.priceWholesale) : '—')]),
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Розница'), el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, p.priceRetail ? fmtMoney(p.priceRetail) : '—')]),
      ]),
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Единица'),       el('dd', {}, p.unit),
        el('dt', {}, 'Остаток'),       el('dd', {}, `${p.stock} ${p.unit}`),
        el('dt', {}, 'Зарезервировано'), el('dd', {}, `${p.reserved} ${p.unit}`),
        el('dt', {}, 'Доступно'),      el('dd', {}, stockIndicator(free, p.stock)),
        el('dt', {}, 'Маржа розница'), el('dd', {}, margin),
      ]),
    ]),
    foot: [
      can('edit-stock') ? el('button', { class:'btn', onclick: () => { closeModal(); openEditStock(p); } }, '✏️ Изменить остаток') : null,
      el('button', { class:'btn btn-primary', onclick: () => { closeModal(); toast(`+1 шт «${p.sku}» в новую сделку`, 'success'); } }, '+ В сделку'),
    ],
  });
}

// Правка остатка товара (право edit-stock: директор / кладовщик)
function openEditStock(p) {
  const stock = fInput('Остаток', String(p.stock), { type: 'number' });
  const reserved = fInput('Зарезервировано', String(p.reserved), { type: 'number' });
  openModal({
    title: 'Остаток: ' + p.sku,
    body: el('div', {}, [stock.row, reserved.row]),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class:'btn btn-primary', onclick: async () => {
        const s = +stock.get() || 0, r = +reserved.get() || 0;
        try {
          await window.__API__.apiFetch('products/' + p.id + '/stock', { method: 'PUT', body: { stock: s, reserved: r } });
          p.stock = s; p.reserved = r;
          const cur = document.querySelector('#nav button.active')?.dataset.view || 'warehouse';
          closeModal(); toast('Остаток обновлён', 'success'); navigate(cur);
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Сохранить'),
    ],
  });
}

function openShipmentDetail(id) {
  const s = byId(state.shipments, id);
  if (!s) return;
  const cl = clientById(s.client);
  const d = byId(state.deals, s.deal);
  openModal({
    title: 'Отгрузка ' + s.no,
    body: el('div', {}, [
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Сделка'),    el('dd', {}, d ? `№${d.no} · ${d.title}` : '—'),
        el('dt', {}, 'Клиент'),     el('dd', {}, cl.name),
        el('dt', {}, 'Адрес'),      el('dd', {}, s.destination),
        el('dt', {}, 'Дата'),       el('dd', {}, fmtDate(s.date)),
        el('dt', {}, 'Позиций'),    el('dd', {}, s.items),
        el('dt', {}, 'Вес'),        el('dd', {}, s.weight + ' кг'),
        el('dt', {}, 'Транспорт'),  el('dd', {}, s.transport),
        el('dt', {}, 'Водитель'),   el('dd', {}, s.driver),
        el('dt', {}, 'Статус'),     el('dd', {}, s.status),
      ]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: () => printShipment(s) }, '🖨 Печать ТТН'),
      el('button', { class:'btn btn-primary', onclick: async () => { s.status = 'delivered'; try { await window.__API__.apiFetch('shipments/' + s.id, { method: 'PUT', body: { status_id: 'delivered' } }); closeModal(); toast('Отгрузка отмечена доставленной', 'success'); navigate('shipments'); } catch (err) { toast('Не удалось сохранить', 'error'); } } }, '✓ Доставлено'),
    ],
  });
}

function openInvoiceDetail(id) {
  const iv = byId(state.invoices, id);
  if (!iv) return;
  const cl = clientById(iv.client);
  const d = byId(state.deals, iv.deal);
  openModal({
    title: 'Счёт ' + iv.no,
    body: el('div', {}, [
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Клиент'),  el('dd', { class:'strong' }, cl.name + ' · БИН ' + cl.bin),
        el('dt', {}, 'Сделка'),  el('dd', {}, d ? `№${d.no} · ${d.title}` : '—'),
        el('dt', {}, 'Дата'),    el('dd', {}, fmtDate(iv.date)),
        el('dt', {}, 'Сумма'),    el('dd', { class:'strong', style:'font-size:18px' }, fmtMoney(iv.amount)),
        el('dt', {}, 'Срок'),    el('dd', {}, fmtDate(iv.due)),
        el('dt', {}, 'Статус'),   el('dd', {}, iv.status),
      ]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: () => { const dl = byId(state.deals, iv.deal); if (dl) printInvoice(dl); else toast('Сделка не найдена', 'warn'); } }, '🖨 PDF'),
      iv.status !== 'paid'
        ? el('button', { class:'btn btn-primary', onclick: async () => { iv.status = 'paid'; try { await window.__API__.apiFetch('invoices/' + iv.id, { method: 'PUT', body: { status_id: 'paid' } }); closeModal(); toast('Оплата зарегистрирована', 'success'); navigate('invoices'); } catch (err) { toast('Не удалось сохранить', 'error'); } } }, '✓ Оплачено')
        : el('button', { class:'btn', disabled: 'disabled' }, '✓ Уже оплачен'),
    ],
  });
}

function openSupplierDetail(id) {
  const sp = byId(state.suppliers, id);
  if (!sp) return;
  openModal({
    title: sp.name,
    body: el('div', {}, [
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Контакт'),       el('dd', {}, sp.contact),
        el('dt', {}, 'Телефон'),       el('dd', {}, sp.phone),
        el('dt', {}, 'Email'),         el('dd', {}, sp.email),
        el('dt', {}, 'Доля закупок'),   el('dd', { class:'strong' }, sp.share + '%'),
        el('dt', {}, 'Последняя поставка'), el('dd', {}, fmtDate(sp.lastDelivery)),
        el('dt', {}, 'Комментарий'),    el('dd', {}, sp.note),
      ]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: () => stub('История поставок', 'Лента всех приходов от поставщика с суммами, позициями и сроками.') }, '📦 История'),
      el('button', { class:'btn btn-primary', onclick: () => { closeModal(); toast('Создан заказ на поставщика', 'success'); } }, '+ Заказ'),
    ],
  });
}

// ---------- Напоминания по задачам ----------
// Статус срока задачи: overdue | today | soon | future | none
function taskDue(t) {
  if (!t || !t.due) return { kind: 'none' };
  const due = new Date(String(t.due).replace(' ', 'T'));
  if (isNaN(due.getTime())) return { kind: 'none' };
  const now = new Date();
  if (due.getTime() < now.getTime()) return { kind: 'overdue', due };
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
  if (dueDay.getTime() === startToday.getTime()) return { kind: 'today', due };
  if (due.getTime() - now.getTime() < 2 * 86400000) return { kind: 'soon', due };
  return { kind: 'future', due };
}
// Открытые задачи текущего пользователя, требующие внимания (просрочено/сегодня)
function taskReminders() {
  return visibleTasks()
    .filter(t => !t.done && ['overdue', 'today'].includes(taskDue(t).kind))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

// ---------- Notification dropdown ----------
function toggleNotifications() {
  const root = $('#dropdown-root');
  if (root.firstChild) { root.innerHTML = ''; return; }
  const backdrop = el('div', { class: 'backdrop-click', onclick: () => root.innerHTML = '' });
  const reminders = taskReminders().map(t => {
    const od = taskDue(t).kind === 'overdue';
    return { text: (od ? 'Просрочена задача: ' : 'Задача на сегодня: ') + t.title, time: 'срок: ' + t.due, type: od ? 'error' : 'warn' };
  });
  const items = reminders.concat(state.notifications || []);
  const panel = el('div', { class: 'dropdown' }, [
    el('div', { class: 'dropdown-head' }, [
      el('h4', {}, 'Уведомления' + (reminders.length ? ` · ${reminders.length}` : '')),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { root.innerHTML = ''; toast('Все уведомления отмечены прочитанными'); } }, 'Прочитать все'),
    ]),
    el('div', { class: 'dropdown-body' }, items.length ? items.map(n => {
      const ic = { error: '⚠️', warn: '🟡', info: 'ℹ️' }[n.type] || 'ℹ️';
      return el('div', { class: 'dropdown-item', onclick: () => { root.innerHTML = ''; toast(n.text); } }, [
        el('span', { class: 'di-icon' }, ic),
        el('div', { class: 'di-body' }, [
          el('div', {}, n.text),
          el('div', { class: 'di-time' }, n.time),
        ]),
      ]);
    }) : [el('div', { class: 'dropdown-item muted', style: 'justify-content:center' }, 'Нет уведомлений')]),
  ]);
  root.append(backdrop, panel);
}

// ---------- About modal ----------
function openAbout() {
  stub(
    'KES CRM — мокап',
    'Это интерактивный фронт-прототип CRM для ТОО KazEnergoSnab. Все данные хранятся локально в браузере (localStorage).',
    [
      '12 разделов: дашборд, сделки, клиенты, каталог, склад, документы и т.д.',
      'Реалистичные демо-данные: 15 клиентов с БИНами, 25 SKU, ~1100 SKU в каталоге EKF',
      'Изменения сохраняются между перезагрузками (кнопка «Сброс» в сайдбаре возвращает к исходному)',
      'Следующий шаг — поднять Cloudflare Worker + D1 под уже понятную схему',
    ]
  );
}

// ---------- Print invoice (PDF via window.print) ----------
function printInvoice(deal) {
  const cl = clientById(deal.client);
  const items = (deal.lineItems || []).map(it => {
    const p = byId(state.products, it.product);
    if (!p) return null;
    const price = it.priceUsed || p.priceWholesale;
    return { sku: p.sku, name: p.name, unit: p.unit, qty: it.qty, price, sum: it.qty * price };
  }).filter(Boolean);
  if (!items.length) {
    toast('Нет позиций для печати — добавьте товары', 'warn');
    return;
  }
  const subtotal = items.reduce((s, it) => s + it.sum, 0);
  const vat = Math.round(subtotal * 0.12);
  const total = subtotal + vat;
  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });
  const invNo = 'СФ-' + today.getFullYear() + '-0' + Math.floor(Math.random()*900 + 100);

  // Открываем новое окно с print-friendly разметкой
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${invNo}</title>
    <link rel="stylesheet" href="${location.origin}/styles.css">
  </head><body style="background:#F4F5F7;padding:20px">
    <div class="print-controls">
      <button onclick="window.print()" class="btn btn-primary">🖨 Печать / PDF</button>
      <button onclick="window.close()" class="btn">Закрыть</button>
    </div>
    <div class="print-area">
      <div class="pr-head">
        <div class="pr-logo">
          <svg width="50" height="56" viewBox="0 0 100 110">
            <polygon points="50,5 90,28 90,82 50,105 10,82 10,28" fill="none" stroke="#00A6E2" stroke-width="6"/>
            <text x="50" y="62" text-anchor="middle" font-family="Arial" font-weight="900" font-size="32" fill="#111">KES</text>
          </svg>
          <div>
            <h2>СЧЁТ-ФАКТУРА ${invNo}</h2>
            <div style="color:#666;font-size:12px;margin-top:4px">от ${dateStr}</div>
          </div>
        </div>
        <div class="pr-meta">
          <div>По сделке № <b>${deal.no}</b></div>
          <div>Срок оплаты: 5 раб. дней</div>
          <div style="margin-top:6px;color:#888">Образец — не имеет юридической силы</div>
        </div>
      </div>

      <div class="pr-parties">
        <div>
          <div class="party-title">Поставщик</div>
          <div class="party-name">ТОО «KazEnergoSnab»</div>
          <div class="party-line">БИН: 180440099887</div>
          <div class="party-line">Адрес: г. Караганда, ул. Бытовая, 13/1</div>
          <div class="party-line">Тел: +7 (7212) 98-04-41</div>
          <div class="party-line">ИИК: KZ_____________________ в АО «Народный Банк»</div>
          <div class="party-line">БИК: HSBKKZKX</div>
        </div>
        <div>
          <div class="party-title">Покупатель</div>
          <div class="party-name">${cl.name}</div>
          <div class="party-line">БИН: ${cl.bin}</div>
          <div class="party-line">${cl.city}, ${cl.address}</div>
          <div class="party-line">Контакт: ${cl.contact} · ${cl.phone}</div>
        </div>
      </div>

      <table class="pr-table">
        <thead>
          <tr>
            <th style="width:32px">#</th>
            <th>Наименование</th>
            <th style="width:80px">Артикул</th>
            <th class="num" style="width:60px">Ед.</th>
            <th class="num" style="width:60px">Кол-во</th>
            <th class="num" style="width:90px">Цена</th>
            <th class="num" style="width:110px">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, i) => `<tr>
            <td>${i+1}</td>
            <td>${it.name}</td>
            <td style="font-family:monospace;font-size:11px">${it.sku}</td>
            <td class="num">${it.unit}</td>
            <td class="num">${it.qty}</td>
            <td class="num">${fmtMoney(it.price)}</td>
            <td class="num"><b>${fmtMoney(it.sum)}</b></td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="pr-totals">
        <div class="total-line"><span>Сумма без НДС:</span> <span>${fmtMoney(subtotal)}</span></div>
        <div class="total-line"><span>НДС 12%:</span> <span>${fmtMoney(vat)}</span></div>
        <div class="total-line grand"><span>ИТОГО К ОПЛАТЕ:</span> <span>${fmtMoney(total)}</span></div>
      </div>

      <div style="margin-top:14px;padding:12px;background:#FAFBFC;border-radius:6px;font-size:11px;color:#555">
        <b>Сумма прописью:</b> ${numberToRussianWords(total)} тенге 00 тиын.
      </div>

      <div class="pr-foot">
        <div>
          <div>Поставку произвёл: ____________________</div>
          <div style="margin-top:14px">Получил: ____________________</div>
          <div style="margin-top:4px;color:#aaa">М.П.</div>
        </div>
        <div class="pr-stamp">место<br>печати<br>и подписи</div>
      </div>
    </div>
  </body></html>`);
  w.document.close();
}

// ---------- Печать ТТН и экспорт отчётов (PDF через window.print) ----------
const PRINT_LOGO = `<svg width="50" height="56" viewBox="0 0 100 110"><polygon points="50,5 90,28 90,82 50,105 10,82 10,28" fill="none" stroke="#00A6E2" stroke-width="6"/><text x="50" y="62" text-anchor="middle" font-family="Arial" font-weight="900" font-size="32" fill="#111">KES</text></svg>`;

function buildPrintDoc(title, inner) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
    <link rel="stylesheet" href="${location.origin}/styles.css">
  </head><body style="background:#F4F5F7;padding:20px">
    <div class="print-controls">
      <button onclick="window.print()" class="btn btn-primary">🖨 Печать / PDF</button>
      <button onclick="window.close()" class="btn">Закрыть</button>
    </div>
    <div class="print-area">${inner}</div>
  </body></html>`;
}

// Печать товарно-транспортной накладной (ТТН). Окно открываем сразу (анти-попап-блок),
// позиции по сделке подгружаем асинхронно и дописываем.
function printShipment(sh) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#666">Готовлю ТТН…</body>');
  (async () => {
    const cl = clientById(sh.client);
    const deal = byId(state.deals, sh.deal);
    let items = [];
    if (sh.deal) {
      try {
        const d = await window.__API__.loadDeal(sh.deal);
        items = (d.lineItems || []).map(it => { const p = byId(state.products, it.product); return p ? { sku: p.sku, name: p.name, unit: p.unit, qty: it.qty } : null; }).filter(Boolean);
      } catch (e) {}
    }
    const dateStr = fmtDate(sh.date);
    const totalQty = items.reduce((s, it) => s + it.qty, 0);
    const rows = items.length
      ? items.map((it, i) => `<tr><td>${i+1}</td><td>${it.name}</td><td style="font-family:monospace;font-size:11px">${it.sku}</td><td class="num">${it.unit}</td><td class="num">${it.qty}</td></tr>`).join('')
      : `<tr><td colspan="5" style="text-align:center;color:#999;padding:14px">Позиции по сделке не указаны</td></tr>`;
    const inner = `
      <div class="pr-head">
        <div class="pr-logo">${PRINT_LOGO}<div><h2>ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ ${sh.no}</h2><div style="color:#666;font-size:12px;margin-top:4px">от ${dateStr}</div></div></div>
        <div class="pr-meta">${deal ? `<div>По сделке № <b>${deal.no}</b></div>` : ''}<div style="margin-top:6px;color:#888">Образец — не имеет юридической силы</div></div>
      </div>
      <div class="pr-parties">
        <div><div class="party-title">Грузоотправитель</div><div class="party-name">ТОО «KazEnergoSnab»</div><div class="party-line">г. Караганда, ул. Бытовая, 13/1</div><div class="party-line">Тел: +7 (7212) 98-04-41</div></div>
        <div><div class="party-title">Грузополучатель</div><div class="party-name">${cl.name}</div><div class="party-line">БИН: ${cl.bin || '—'}</div><div class="party-line">${cl.city || ''}${cl.address ? ', ' + cl.address : ''}</div><div class="party-line">Контакт: ${cl.contact || '—'} · ${cl.phone || ''}</div></div>
      </div>
      <div class="pr-parties">
        <div><div class="party-title">Транспорт</div><div class="party-line">${sh.transport || '—'}</div><div class="party-line">Водитель: ${sh.driver || '—'}</div></div>
        <div><div class="party-title">Адрес доставки</div><div class="party-line">${sh.destination || '—'}</div></div>
      </div>
      <table class="pr-table"><thead><tr><th style="width:32px">#</th><th>Наименование</th><th style="width:90px">Артикул</th><th class="num" style="width:60px">Ед.</th><th class="num" style="width:70px">Кол-во</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pr-totals">
        <div class="total-line"><span>Мест:</span> <span>${sh.items || 0}</span></div>
        <div class="total-line"><span>Вес, кг:</span> <span>${sh.weight || 0}</span></div>
        <div class="total-line grand"><span>Всего единиц:</span> <span>${totalQty}</span></div>
      </div>
      <div class="pr-foot">
        <div><div>Отпустил: ____________________</div><div style="margin-top:12px">Принял (водитель): ____________________</div><div style="margin-top:12px">Получил: ____________________</div><div style="margin-top:4px;color:#aaa">М.П.</div></div>
        <div class="pr-stamp">место<br>печати</div>
      </div>`;
    w.document.open(); w.document.write(buildPrintDoc('ТТН ' + sh.no, inner)); w.document.close();
  })();
}

// Экспорт сводного отчёта в PDF (по данным state)
function exportReportPDF() {
  const deals = state.deals;
  const open = deals.filter(d => !['closed','lost'].includes(d.stage));
  const pipeline = open.reduce((a, d) => a + d.amount, 0);
  const won = deals.filter(d => ['paid','shipped','closed'].includes(d.stage)).reduce((a, d) => a + d.amount, 0);
  const overdue = state.invoices.filter(i => i.status === 'overdue');
  const overdueSum = overdue.reduce((a, i) => a + i.amount, 0);
  const byStage = STAGES.map(s => { const ds = deals.filter(d => d.stage === s.id); return { label: s.label, count: ds.length, sum: ds.reduce((a, d) => a + d.amount, 0) }; }).filter(x => x.count);
  const debtors = state.clients.filter(c => c.balance < 0).sort((a, b) => a.balance - b.balance);
  const top = state.clients.slice().sort((a, b) => b.ltv - a.ltv).slice(0, 10);
  const dateStr = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });
  const h3 = (t) => `<h3 style="margin:18px 0 8px;font-size:14px">${t}</h3>`;
  const inner = `
    <div class="pr-head">
      <div class="pr-logo">${PRINT_LOGO}<div><h2>СВОДНЫЙ ОТЧЁТ</h2><div style="color:#666;font-size:12px;margin-top:4px">на ${dateStr}</div></div></div>
      <div class="pr-meta"><div>ТОО «KazEnergoSnab»</div><div style="margin-top:6px;color:#888">Образец</div></div>
    </div>
    ${h3('Ключевые показатели')}
    <table class="pr-table"><tbody>
      <tr><td>Сделок всего</td><td class="num"><b>${deals.length}</b></td></tr>
      <tr><td>Пайплайн (открытые сделки)</td><td class="num"><b>${fmtMoney(pipeline)}</b></td></tr>
      <tr><td>Выручка (оплачено / отгружено / закрыто)</td><td class="num"><b>${fmtMoney(won)}</b></td></tr>
      <tr><td>Дебиторка (просроченных счетов: ${overdue.length})</td><td class="num"><b>${fmtMoney(overdueSum)}</b></td></tr>
    </tbody></table>
    ${h3('Сделки по этапам')}
    <table class="pr-table"><thead><tr><th>Этап</th><th class="num">Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>
      ${byStage.map(s => `<tr><td>${s.label}</td><td class="num">${s.count}</td><td class="num">${fmtMoney(s.sum)}</td></tr>`).join('')}
    </tbody></table>
    ${h3('Дебиторская задолженность')}
    <table class="pr-table"><thead><tr><th>Клиент</th><th class="num">Долг</th></tr></thead><tbody>
      ${debtors.length ? debtors.map(c => `<tr><td>${c.name}</td><td class="num"><b>${fmtMoney(Math.abs(c.balance))}</b></td></tr>`).join('') : '<tr><td colspan="2" style="text-align:center;color:#999">Нет задолженности</td></tr>'}
    </tbody></table>
    ${h3('Топ-10 клиентов по обороту')}
    <table class="pr-table"><thead><tr><th>Клиент</th><th class="num">Оборот (LTV)</th></tr></thead><tbody>
      ${top.map(c => `<tr><td>${c.name}</td><td class="num">${fmtMoney(c.ltv)}</td></tr>`).join('')}
    </tbody></table>`;
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  w.document.write(buildPrintDoc('Отчёт KES', inner));
  w.document.close();
}

// Простой конвертер числа в слова (для счёта-фактуры)
function numberToRussianWords(n) {
  n = Math.round(n);
  if (n === 0) return 'ноль';
  const ones = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  function under1000(x, fem) {
    let r = []; const h = Math.floor(x/100); x %= 100;
    if (h) r.push(hundreds[h]);
    if (x < 20) {
      if (x) {
        if (fem && x === 1) r.push('одна');
        else if (fem && x === 2) r.push('две');
        else r.push(ones[x]);
      }
    } else {
      r.push(tens[Math.floor(x/10)]);
      if (x % 10) {
        if (fem && x%10 === 1) r.push('одна');
        else if (fem && x%10 === 2) r.push('две');
        else r.push(ones[x%10]);
      }
    }
    return r.join(' ');
  }
  const parts = [];
  const mln = Math.floor(n/1_000_000); n %= 1_000_000;
  const tys = Math.floor(n/1000); n %= 1000;
  if (mln) parts.push(under1000(mln) + ' ' + plural(mln,'миллион','миллиона','миллионов'));
  if (tys) parts.push(under1000(tys, true) + ' ' + plural(tys,'тысяча','тысячи','тысяч'));
  if (n)   parts.push(under1000(n));
  return parts.join(' ').replace(/\s+/g,' ').trim();
}
function plural(n, one, two, five) {
  n = Math.abs(n) % 100;
  const m = n % 10;
  if (n > 10 && n < 20) return five;
  if (m > 1 && m < 5) return two;
  if (m === 1) return one;
  return five;
}

// ---------- User editor (admin) ----------
function openEditUser(id) {
  const u = id ? byId(state.users, id) : null;
  const isNew = !u;
  const name = fInput('ФИО', u?.name || '');
  const email = fInput('Email', u?.email || '', { type: 'email', placeholder: 'name@snabenergo.kz' });
  const phone = fInput('Телефон', u?.phone || '', { placeholder: '+7 7XX XXX XX XX' });
  const roleSel = fSelect('Роль',
    Object.entries(ROLES).map(([key, r]) => ({ value: key, label: r.label })),
    u?.roleKey || 'manager');
  const password = fInput('Пароль', isNew ? 'demo' : '', { placeholder: isNew ? '' : 'пусто — пароль без изменений' });
  const colorSel = fSelect('Цвет аватара',
    [['#00A6E2','Голубой'],['#7B61FF','Фиолетовый'],['#FF9F43','Оранжевый'],['#28C76F','Зелёный'],['#EF4444','Красный'],['#111','Чёрный']]
      .map(([v,l]) => ({ value: v, label: l })),
    u?.color || '#00A6E2');

  openModal({
    title: isNew ? 'Новый пользователь' : 'Редактирование: ' + u.name,
    body: el('div', {}, [
      name.row, email.row, phone.row, roleSel.row, password.row, colorSel.row,
      el('div', { style:'margin-top:8px;padding:10px 12px;background:#F4F5F7;border-radius:6px;font-size:11.5px;color:#6B7280' },
        'Пользователь сможет войти по email + пароль. В проде на email уйдёт письмо-приглашение с одноразовой ссылкой.'),
    ]),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class:'btn btn-primary', onclick: async () => {
        if (!name.get().trim() || !email.get().trim()) { toast('Заполните имя и email', 'warn'); return; }
        const rk = roleSel.get();
        const initials = name.get().trim().split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
        const body = { name: name.get().trim(), email: email.get().trim(), phone: phone.get(), role_key: rk, avatar: initials, color: colorSel.get() };
        try {
          if (isNew) {
            body.active = 1;
            const saved = await window.__API__.apiFetch('users', { method: 'POST', body });
            await window.__API__.apiFetch('users/' + saved.id + '/password', { method: 'POST', body: { password: password.get().trim() || 'demo' } });
            state.users.push({ id: saved.id, name: saved.name, email: saved.email, phone: saved.phone, roleKey: saved.role_key, role: (ROLES[rk]||{}).label || rk, avatar: saved.avatar, color: saved.color, active: saved.active !== 0 });
            toast('Пользователь добавлен', 'success');
          } else {
            const saved = await window.__API__.apiFetch('users/' + u.id, { method: 'PUT', body });
            if (password.get().trim()) await window.__API__.apiFetch('users/' + u.id + '/password', { method: 'POST', body: { password: password.get().trim() } });
            Object.assign(u, { name: saved.name, email: saved.email, phone: saved.phone, roleKey: saved.role_key, role: (ROLES[rk]||{}).label || rk, avatar: saved.avatar, color: saved.color, active: saved.active !== 0 });
            toast('Изменения сохранены', 'success');
          }
          closeModal(); navigate('settings');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, isNew ? 'Создать' : 'Сохранить'),
    ],
  });
}

// ---------- Global search ----------
function runSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return;
  const hits = {
    clients: state.clients.filter(c => (c.name+c.bin+c.contact).toLowerCase().includes(q)),
    deals:   state.deals.filter(d => (d.title+d.no).toLowerCase().includes(q)),
    products: state.products.filter(p => (p.name+p.sku+p.brand).toLowerCase().includes(q)),
  };
  const total = hits.clients.length + hits.deals.length + hits.products.length;
  if (!total) {
    stub('Ничего не найдено', 'По запросу «' + q + '» совпадений нет.');
    return;
  }
  const body = el('div', {});
  if (hits.clients.length) {
    body.append(el('div', { style:'font-weight:600;font-size:12px;color:#6B7280;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.5px' }, `Клиенты (${hits.clients.length})`));
    hits.clients.forEach(c => body.append(el('div', { class:'dropdown-item', style:'border-radius:6px;border:0', onclick: () => { closeModal(); openClientDetail(c.id); } }, [
      el('span', { class:'di-icon' }, '👤'),
      el('div', { class:'di-body' }, [el('div', { class:'strong' }, c.name), el('div', { class:'di-time' }, c.city + ' · БИН ' + c.bin)]),
    ])));
  }
  if (hits.deals.length) {
    body.append(el('div', { style:'font-weight:600;font-size:12px;color:#6B7280;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.5px' }, `Сделки (${hits.deals.length})`));
    hits.deals.forEach(d => body.append(el('div', { class:'dropdown-item', style:'border-radius:6px;border:0', onclick: () => { closeModal(); openDealDetail(d.id); } }, [
      el('span', { class:'di-icon' }, '💼'),
      el('div', { class:'di-body' }, [el('div', { class:'strong' }, d.title), el('div', { class:'di-time' }, '№' + d.no + ' · ' + fmtMoneyK(d.amount))]),
    ])));
  }
  if (hits.products.length) {
    body.append(el('div', { style:'font-weight:600;font-size:12px;color:#6B7280;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.5px' }, `Товары (${hits.products.length})`));
    hits.products.slice(0,10).forEach(p => body.append(el('div', { class:'dropdown-item', style:'border-radius:6px;border:0', onclick: () => { closeModal(); openProductDetail(p.id); } }, [
      el('span', { class:'di-icon' }, '📦'),
      el('div', { class:'di-body' }, [el('div', { class:'strong' }, p.name), el('div', { class:'di-time' }, p.sku + ' · ' + p.brand)]),
    ])));
  }
  openModal({ title: 'Результаты: ' + total, body, foot: [el('button', { class:'btn', onclick: closeModal }, 'Закрыть')] });
}

// ============================================================
// VIEW: DASHBOARD
// ============================================================
VIEWS.dashboard = () => {
  const myDeals = visibleDeals();
  const myClients = visibleClients();
  const myTasks = visibleTasks();
  const totalRevenue = myDeals.filter(d => ['paid','shipped','closed'].includes(d.stage))
    .reduce((s,d) => s + d.amount, 0);
  const pipelineValue = myDeals.filter(d => !['closed','lost'].includes(d.stage))
    .reduce((s,d) => s + d.amount, 0);
  const debtTotal = myClients.reduce((s,c) => s + (c.balance < 0 ? -c.balance : 0), 0);
  const overdueCount = state.invoices.filter(i => i.status === 'overdue').length;
  const newLeads = state.leads.filter(l => l.status === 'new').length;
  const tasksToday = myTasks.filter(t => !t.done).length;

  const wrap = el('div');
  const firstName = currentUser.name.split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, `${greet}, ${firstName} 👋`),
      el('div', { class: 'sub' }, `Сводка по KazEnergoSnab · ${role().seeAllData ? 'все данные компании' : 'ваши клиенты и сделки'}`),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => exportReportPDF() }, '📥 Экспорт'),
      el('button', { class: 'btn btn-primary', onclick: () => openNewDeal() }, '+ Новая сделка'),
    ]),
  ]));

  // 4 KPI карточки
  const stats = el('div', { class: 'grid grid-4' });
  stats.append(statCard('Выручка (закрыто)', fmtMoneyK(totalRevenue), '', '', '💰'));
  stats.append(statCard('Пайплайн',          fmtMoneyK(pipelineValue), '', '', '📈'));
  stats.append(statCard('Дебиторка',         fmtMoneyK(debtTotal), overdueCount ? overdueCount + ' просрочка' : '', '', '⚠️'));
  stats.append(statCard('Новые заявки',      newLeads, '', '', '📥'));
  wrap.append(stats);

  // 2 колонки: воронка + активность
  const row = el('div', { class: 'grid grid-2 mt-16' });

  // Воронка по этапам
  const funnelCard = el('div', { class: 'card' });
  funnelCard.append(el('div', { class: 'card-head' }, [
    el('h3', {}, 'Воронка продаж'),
    el('a', { class: 'more', 'data-nav': 'deals', 'data-params': '{}' }, 'Все сделки →'),
  ]));
  const funnel = el('div', { class: 'funnel' });
  const maxByStage = Math.max(...STAGES.map(s => myDeals.filter(d => d.stage === s.id).reduce((sum,d)=>sum+d.amount,0)));
  STAGES.forEach(s => {
    if (s.id === 'lost' || s.id === 'closed') return;
    const dealsOnStage = myDeals.filter(d => d.stage === s.id);
    const sum = dealsOnStage.reduce((a,d)=>a+d.amount,0);
    const w = maxByStage ? Math.max(2, Math.round(sum / maxByStage * 100)) : 0;
    funnel.append(el('div', { class: 'funnel-row' }, [
      el('div', { class: 'fn-label' }, `${s.label} (${dealsOnStage.length})`),
      el('div', { class: 'fn-bar' }, el('div', { style: `width:${w}%; background:${s.color}` })),
      el('div', { class: 'fn-val' }, fmtMoneyK(sum)),
    ]));
  });
  funnelCard.append(funnel);
  row.append(funnelCard);

  // Активность / задачи на сегодня
  const actCard = el('div', { class: 'card' });
  actCard.append(el('div', { class: 'card-head' }, [
    el('h3', {}, 'Задачи на сегодня и завтра'),
    el('a', { class: 'more', 'data-nav': 'tasks' }, 'Все задачи →'),
  ]));
  const actList = el('div', { class: 'activity' });
  myTasks.slice(0, 5).forEach(t => {
    const u = userById(t.owner);
    actList.append(el('div', { class: 'activity-item' }, [
      el('div', { class: 'avatar', style: `width:32px;height:32px;background:${u.color}` }, u.avatar),
      el('div', { class: 'av-body flex-1' }, [
        el('div', {}, t.title),
        el('div', { class: 'av-time' }, [
          `${u.name} · ${fmtDate(t.due.split(' ')[0])} ${t.due.split(' ')[1] || ''} `,
          el('span', { class: 'pill ' + (t.priority === 'high' ? 'pill-danger' : t.priority === 'medium' ? 'pill-warn' : 'pill-muted'), style: 'margin-left:6px' }, t.priority === 'high' ? 'высокий' : t.priority === 'medium' ? 'средний' : 'низкий'),
          t.done ? el('span', { class: 'pill pill-success', style:'margin-left:4px' }, 'выполнено') : null,
        ]),
      ]),
    ]));
  });
  actCard.append(actList);
  row.append(actCard);

  wrap.append(row);

  // Низкие остатки + последние сделки
  const row2 = el('div', { class: 'grid grid-2 mt-16' });

  // Низкие остатки
  const stockCard = el('div', { class: 'card' });
  stockCard.append(el('div', { class: 'card-head' }, [el('h3', {}, '⚠️ Низкие остатки'), el('a', { class:'more','data-nav':'warehouse' }, 'Склад →')]));
  const stockBody = el('div', { style:'overflow:hidden' }, el('div', { class:'muted', style:'padding:10px 4px' }, 'Загрузка…'));
  stockCard.append(stockBody);
  row2.append(stockCard);
  // глобально из БД: 5 позиций с минимальным свободным остатком
  window.__API__.apiFetch('products?lowstock=50&limit=5').then(r => {
    const items = (r.data || []).map(row => window.__API__.map.product(row));
    const t = el('table', { class: 'data' });
    t.append(el('tbody', {}, items.length ? items.map(p => {
      const free = p.stock - p.reserved;
      return el('tr', { onclick: () => openProductDetail(p) }, [
        el('td', {}, [
          el('div', { class: 'strong' }, p.name),
          el('div', { class: 'muted' }, p.sku + (p.brand ? ' · ' + p.brand : '')),
        ]),
        el('td', { class: 'num' }, stockIndicator(free, p.stock)),
      ]);
    }) : [el('tr', {}, el('td', { class:'muted', style:'padding:10px 4px' }, 'Низких остатков нет'))]));
    stockBody.innerHTML = ''; stockBody.append(t);
  }).catch(() => { stockBody.innerHTML = ''; stockBody.append(el('div', { class:'muted', style:'padding:10px 4px' }, 'Не удалось загрузить остатки')); });

  // Последние сделки
  const recentCard = el('div', { class: 'card' });
  recentCard.append(el('div', { class: 'card-head' }, [el('h3', {}, 'Последние сделки'), el('a', { class:'more','data-nav':'deals' }, 'Все →')]));
  const rt = el('table', { class: 'data' });
  rt.append(el('tbody', {}, myDeals.slice().sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).slice(0, 6).map(d => {
    const s = stageById(d.stage);
    return el('tr', { onclick: () => openDealDetail(d.id) }, [
      el('td', {}, [
        el('div', { class: 'strong' }, d.title),
        el('div', { class: 'muted' }, '№' + d.no + ' · ' + clientById(d.client).name),
      ]),
      el('td', { class: 'num' }, el('span', { class: 'pill', style: `background:${s.color}22;color:${s.color}` }, s.label)),
      el('td', { class: 'num strong' }, fmtMoneyK(d.amount)),
    ]);
  })));
  recentCard.append(el('div', { style:'overflow:hidden' }, rt));
  row2.append(recentCard);

  wrap.append(row2);

  return wrap;
};

function statCard(label, value, delta, dir, icon) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'stat-icon' }, icon),
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value' }, String(value)),
    delta ? el('div', { class: 'stat-delta ' + dir }, (dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : '') + delta) : null,
  ]);
}

function stockIndicator(free, total) {
  const pct = total ? Math.min(100, Math.round(free / total * 100)) : 0;
  const cls = free < 20 ? 'crit' : free < 50 ? 'low' : '';
  return el('span', { class: 'stock-bar ' + cls }, [
    el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` })),
    el('span', {}, free + ' ' + (total > 0 ? `/ ${total}` : '')),
  ]);
}

// ============================================================
// VIEW: DEALS (kanban)
// ============================================================
let DEALS_VIEW = 'kanban'; // 'kanban' | 'list' — режим отображения сделок

VIEWS.deals = () => {
  const wrap = el('div');
  const myDeals = visibleDeals();
  const isList = DEALS_VIEW === 'list';
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Сделки'),
      el('div', { class: 'sub' }, `${myDeals.length} ${role().seeAllData ? 'активных' : 'ваших активных'} · общая сумма ${fmtMoneyK(myDeals.reduce((s,d)=>s+d.amount,0))}` + (isList ? '' : ' · 💡 перетаскивайте карточки между этапами')),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => { DEALS_VIEW = isList ? 'kanban' : 'list'; navigate('deals'); } }, isList ? '🗂 Канбан' : '📋 Список'),
      el('button', { class: 'btn btn-primary', onclick: () => openNewDeal() }, '+ Сделка'),
    ]),
  ]));

  if (isList) { wrap.append(renderDealsList(myDeals)); return wrap; }

  let dragged = null;

  const kanban = el('div', { class: 'kanban' });
  STAGES.forEach(s => {
    const dealsOnStage = myDeals.filter(d => d.stage === s.id);
    const body = el('div', { class: 'k-col-body' });
    dealsOnStage.forEach(d => {
      const cl = clientById(d.client);
      const m = userById(d.manager);
      const canDragThis = can('edit-deal', d);
      const card = el('div', {
        class: 'k-card',
        draggable: canDragThis ? 'true' : null,
        onclick: () => openDealDetail(d.id),
      }, [
        el('div', { class: 'k-card-no' }, '№' + d.no + ' · до ' + fmtDate(d.target)),
        el('div', { class: 'k-card-title' }, d.title),
        el('div', { class: 'muted', style:'font-size:11.5px' }, cl.name),
        el('div', { class: 'k-card-foot mt-12' }, [
          el('span', { class: 'k-card-amount' }, fmtMoneyK(d.amount)),
          el('span', { class: 'avatar', style: `background:${m.color}`, title: m.name }, m.avatar),
        ]),
      ]);
      if (canDragThis) {
        card.addEventListener('dragstart', (e) => {
          dragged = { id: d.id, fromStage: d.stage };
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', d.id); } catch(_){}
        });
        card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; });
      }
      body.appendChild(card);
    });

    const col = el('div', { class: 'k-col', 'data-stage': s.id }, [
      el('div', { class: 'k-col-head' }, [
        el('span', { class: 'stage-dot', style: `background:${s.color}` }),
        el('span', { class: 'stage-label' }, s.label),
        el('span', { class: 'stage-count' }, dealsOnStage.length),
      ]),
      body,
    ]);

    col.addEventListener('dragover', (e) => { if (!dragged) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (e.target === col) col.classList.remove('drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!dragged) return;
      const deal = byId(state.deals, dragged.id);
      if (!deal) return;
      if (deal.stage === s.id) return;
      const fromLabel = stageById(deal.stage).label;
      deal.stage = s.id;
      navigate('deals');
      try {
        await window.__API__.apiFetch('deals/' + deal.id, { method: 'PUT', body: { stage_id: s.id } });
        toast(`${deal.title.slice(0,30)}: ${fromLabel} → ${s.label}`, 'success');
      } catch (err) { toast('Не удалось сохранить этап', 'error'); }
    });

    kanban.append(col);
  });
  wrap.append(kanban);
  return wrap;
};

// Табличный вид сделок (toggle «Список») — поиск, фильтр по этапу, сортировка по дате
function renderDealsList(deals) {
  const tw = el('div', { class: 'table-wrap' });
  const searchI = el('input', { placeholder:'Поиск по №, названию, клиенту…', style:'flex:1;min-width:160px' });
  const stageSel = el('select', {}, [el('option', { value:'' }, 'Все этапы'), ...STAGES.map(s => el('option', { value:s.id }, s.label))]);
  tw.append(el('div', { class:'table-toolbar' }, [searchI, stageSel]));
  const host = el('div');
  tw.append(host);

  function render() {
    const q = searchI.value.trim().toLowerCase();
    const st = stageSel.value;
    const list = deals
      .filter(d => !st || d.stage === st)
      .filter(d => {
        if (!q) return true;
        const cl = clientById(d.client);
        return String(d.no || '').toLowerCase().includes(q)
          || String(d.title || '').toLowerCase().includes(q)
          || String(cl && cl.name || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));

    const t = el('table', { class:'data' });
    t.append(el('thead', {}, el('tr', {}, [
      el('th', {}, '№'), el('th', {}, 'Сделка'), el('th', {}, 'Клиент'), el('th', {}, 'Менеджер'),
      el('th', {}, 'Этап'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Срок'),
    ])));
    t.append(el('tbody', {}, list.length ? list.map(d => {
      const cl = clientById(d.client);
      const m = userById(d.manager);
      const s = stageById(d.stage);
      return el('tr', { style:'cursor:pointer', onclick: () => openDealDetail(d.id) }, [
        el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, '№' + d.no),
        el('td', { class:'strong' }, d.title),
        el('td', {}, cl ? cl.name : '—'),
        el('td', {}, el('span', { class:'avatar', style:`background:${m.color};width:26px;height:26px;font-size:11px`, title:m.name }, m.avatar)),
        el('td', {}, el('span', { class:'pill', style:`background:${s.color}22;color:${s.color}` }, s.label)),
        el('td', { class:'num strong' }, fmtMoneyK(d.amount)),
        el('td', { class:'muted' }, d.target ? fmtDate(d.target) : '—'),
      ]);
    }) : [el('tr', {}, el('td', { colspan:7, class:'muted', style:'text-align:center;padding:24px' }, 'Сделок не найдено'))]));
    host.innerHTML = ''; host.append(t);
  }

  let sd; searchI.oninput = () => { clearTimeout(sd); sd = setTimeout(render, 200); };
  stageSel.onchange = render;
  render();
  return tw;
}

async function openDealDetail(id) {
  const d = byId(state.deals, id);
  if (!d) return;
  // ленивая подгрузка позиций сделки из БД
  try {
    const full = await window.__API__.loadDeal(id);
    d.lineItems = full.lineItems || [];
    if (full.amount != null) d.amount = full.amount;
    if (full.items != null) d.items = full.items;
  } catch (e) { if (!d.lineItems) d.lineItems = []; }
  let history = [];
  try { history = await window.__API__.apiFetch('deals/' + id + '/history'); } catch (e) {}
  const cl = clientById(d.client);
  const m = userById(d.manager);
  const s = stageById(d.stage);
  const canEdit = can('edit-deal', d);

  // Контейнеры — буду пере-рендеривать после изменений позиций
  const itemsHost = el('div', { style:'margin-top:8px' });
  const totalHost = el('span', { style:'font-size:20px;font-weight:700' });
  const pickerHost = el('div');

  function recomputeAmount() {
    d.amount = d.lineItems.reduce((s, it) => {
      const p = byId(state.products, it.product);
      return s + (p ? it.qty * (it.priceUsed || p.priceWholesale) : 0);
    }, 0);
    d.items = d.lineItems.reduce((s, it) => s + it.qty, 0);
    totalHost.textContent = fmtMoney(d.amount);
  }

  function renderItems() {
    itemsHost.innerHTML = '';
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Артикул'),
      el('th', {}, 'Товар'),
      el('th', { class:'num' }, 'Кол-во'),
      el('th', { class:'num' }, 'Цена'),
      el('th', { class:'num' }, 'Сумма'),
      el('th', {}, ''),
    ])));
    const tb = el('tbody');
    if (!d.lineItems.length) {
      tb.append(el('tr', { class:'empty-row' }, el('td', { colspan: 6 }, 'Позиций ещё нет. Выберите товар ниже ↓')));
    } else {
      d.lineItems.forEach((it, idx) => {
        const p = byId(state.products, it.product);
        if (!p) return;
        const sum = it.qty * (it.priceUsed || p.priceWholesale);
        tb.append(el('tr', {}, [
          el('td', { style:'font-family:monospace;font-size:11px;color:#6B7280' }, p.sku),
          el('td', {}, [p.name, el('div', { class:'muted', style:'font-size:11px' }, p.brand + ' · ' + p.unit)]),
          el('td', { class:'num' }, canEdit
            ? el('input', { class:'qty', type:'number', min:'1', value: it.qty, oninput: (e) => { it.qty = Math.max(1, +e.target.value || 1); recomputeAmount(); const sumCell = e.target.closest('tr').children[4]; sumCell.textContent = fmtMoney(it.qty * (it.priceUsed || p.priceWholesale)); } })
            : String(it.qty)),
          el('td', { class:'num muted' }, fmtMoney(it.priceUsed || p.priceWholesale)),
          el('td', { class:'num strong' }, fmtMoney(sum)),
          el('td', {}, canEdit ? el('button', { class:'x-btn', title:'Удалить', onclick: () => { d.lineItems.splice(idx, 1); recomputeAmount(); renderItems(); } }, '×') : null),
        ]));
      });
    }
    t.append(tb);
    if (d.lineItems.length) {
      t.append(el('tfoot', {}, el('tr', {}, [
        el('td', { colspan: 4, class:'num' }, 'ИТОГО:'),
        el('td', { class:'num' }, fmtMoney(d.amount)),
        el('td'),
      ])));
    }
    const wrap = el('div', { class:'line-items' }, t);
    itemsHost.append(wrap);
  }

  function renderPicker() {
    pickerHost.innerHTML = '';
    if (!canEdit) return;
    const search = el('input', { placeholder:'Поиск товара по артикулу/названию…', style:'width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;outline:none' });
    const list = el('div', { class:'product-picker' });
    function fill(q = '') {
      list.innerHTML = '';
      const ql = q.toLowerCase().trim();
      const matched = state.products.filter(p => !ql || (p.name + p.sku).toLowerCase().includes(ql)).slice(0, 12);
      matched.forEach(p => {
        list.append(el('div', { class:'pp-item', onclick: () => {
          const existing = d.lineItems.find(it => it.product === p.id);
          if (existing) { existing.qty += 1; toast('Количество увеличено', 'info'); }
          else { d.lineItems.push({ product: p.id, qty: 1, priceUsed: p.priceWholesale }); toast('Товар добавлен', 'success'); }
          recomputeAmount(); renderItems();
        } }, [
          el('div', {}, [el('div', {}, p.name), el('div', { class:'pp-sku' }, p.sku + ' · ' + p.brand)]),
          el('span', { class:'pp-price' }, fmtMoney(p.priceWholesale)),
        ]));
      });
      if (!matched.length) list.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Ничего не найдено'));
    }
    search.oninput = (e) => fill(e.target.value);
    fill();
    pickerHost.append(
      el('div', { style:'font-weight:600;font-size:12px;margin:14px 0 6px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px' }, 'Добавить товар из каталога'),
      search, list
    );
  }

  recomputeAmount();
  renderItems();
  renderPicker();

  const body = el('div', {}, [
    el('div', { style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px' }, [
      el('span', { class: 'pill', style: `background:${s.color}22;color:${s.color};font-size:13px;padding:4px 12px` }, s.label),
      totalHost,
    ]),
    el('dl', { class: 'kv', style:'margin-bottom:14px' }, [
      el('dt', {}, 'Номер'),    el('dd', {}, '№' + d.no),
      el('dt', {}, 'Клиент'),    el('dd', {}, cl.name + (cl.bin ? ' · БИН ' + cl.bin : '')),
      el('dt', {}, 'Менеджер'),  el('dd', {}, m.name),
      el('dt', {}, 'Создана'),    el('dd', {}, fmtDate(d.created)),
      el('dt', {}, 'Срок'),       el('dd', {}, fmtDate(d.target)),
    ]),
    el('div', { style:'font-weight:600;font-size:13px;margin-bottom:6px' }, 'Позиции'),
    itemsHost,
    pickerHost,
    history.length ? el('div', { style:'margin-top:16px' }, [
      el('div', { style:'font-weight:600;font-size:13px;margin-bottom:8px' }, 'История этапов'),
      el('div', {}, history.map(h => {
        const to = stageById(h.to_stage);
        const from = h.from_stage ? stageById(h.from_stage) : null;
        return el('div', { style:'display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #F3F4F6;font-size:12px' }, [
          el('span', { class:'pill', style:`background:${to.color}22;color:${to.color};font-size:11px` }, to.label),
          el('span', { class:'muted' }, (from ? from.label + ' → ' : 'создана') + ' · ' + (h.user_name || '—') + ' · ' + String(h.changed_at || '').slice(0, 16)),
        ]);
      })),
    ]) : null,
  ]);

  const stageSelect = el('select', { style:'padding:6px 10px;border:1px solid #E5E7EB;border-radius:6px' });
  STAGES.forEach(st => {
    const opt = el('option', { value: st.id }, st.label);
    if (st.id === d.stage) opt.selected = true;
    stageSelect.append(opt);
  });
  if (!canEdit) stageSelect.disabled = true;

  openModal({
    title: d.title,
    body,
    foot: [
      el('div', { style:'margin-right:auto;font-size:12px;color:#6B7280;display:flex;align-items:center;gap:8px' }, ['Этап:', stageSelect]),
      el('button', { class: 'btn', onclick: () => printInvoice(d) }, '🖨 Печать СФ'),
      (currentUser && currentUser.roleKey === 'director') ? el('button', { class: 'btn btn-danger', onclick: async () => {
        if (!confirm(`Удалить сделку «${d.title}» (№${d.no})?\nСвязанные счета, отгрузки и задачи будут отвязаны. Действие необратимо.`)) return;
        try {
          await window.__API__.apiFetch('deals/' + d.id, { method: 'DELETE' });
          const i = state.deals.findIndex(x => x.id === d.id);
          if (i >= 0) state.deals.splice(i, 1);
          closeModal(); toast('Сделка удалена', 'success'); navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, '🗑 Удалить') : null,
      canEdit ? el('button', { class: 'btn btn-primary', onclick: async () => {
        d.stage = stageSelect.value;
        try {
          const saved = await window.__API__.apiFetch('deals/' + d.id, { method: 'PUT', body: { ...window.__API__.toApi.deal(d), lineItems: window.__API__.toApi.dealItems(d.lineItems) } });
          Object.assign(d, window.__API__.map.deal(saved));
          closeModal(); toast('Сделка сохранена', 'success'); navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Сохранить') : null,
    ],
  });
}

function openNewDeal() {
  const form = el('div');
  const titleI = el('input', { placeholder: 'Например: Кабель ВВГнг 3×2.5 для офиса' });
  const clientSel = el('select');
  state.clients.forEach(c => clientSel.append(el('option', { value: c.id }, c.name)));
  const amountI = el('input', { type: 'number', placeholder: '0' });
  const mgrSel = el('select');
  state.users.filter(u => u.role.includes('Менеджер')).forEach(u => mgrSel.append(el('option', { value: u.id }, u.name)));

  form.append(
    el('div', { class:'form-row' }, [el('label', {}, 'Название сделки'), titleI]),
    el('div', { class:'form-row' }, [el('label', {}, 'Клиент'), clientSel]),
    el('div', { class:'form-row' }, [el('label', {}, 'Сумма, ₸'), amountI]),
    el('div', { class:'form-row' }, [el('label', {}, 'Менеджер'), mgrSel]),
  );

  openModal({
    title: 'Новая сделка',
    body: form,
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!titleI.value.trim()) { titleI.focus(); return; }
        const today = new Date().toISOString().slice(0,10);
        const num = state.deals.length + 160;
        const nd = { no: '2026-0' + num, client: clientSel.value, manager: mgrSel.value, stage: 'new', amount: Number(amountI.value) || 0, items: 0, created: today, target: today, title: titleI.value.trim() };
        try {
          const saved = await window.__API__.apiFetch('deals', { method: 'POST', body: window.__API__.toApi.deal(nd) });
          state.deals.unshift(window.__API__.map.deal(saved));
          closeModal(); toast('Сделка создана', 'success'); navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Создать сделку'),
    ],
  });
}

// ============================================================
// VIEW: CLIENTS
// ============================================================
VIEWS.clients = () => {
  const wrap = el('div');
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Клиенты'),
      el('div', { class: 'sub' }, `${state.clients.length} клиентов · LTV ${fmtMoneyK(state.clients.reduce((s,c)=>s+c.ltv,0))}`),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => openImport('clients') }, '📥 Импорт'),
      el('button', { class: 'btn btn-primary', onclick: openNewClient }, '+ Клиент'),
    ]),
  ]));

  // Локальная фильтрация
  const filterState = { q: '', type: '', city: '' };
  const cities = Array.from(new Set(state.clients.map(c => c.city)));
  const searchI = el('input', { placeholder:'Поиск клиента или БИН…', oninput: e => { filterState.q = e.target.value.toLowerCase(); refresh(); } });
  const typeS = el('select', { onchange: e => { filterState.type = e.target.value; refresh(); } },
    [el('option', { value:'' }, 'Все типы'), el('option', { value:'opt' }, 'Опт'), el('option', { value:'rozn' }, 'Розница'), el('option', { value:'dilr' }, 'Дилер')]);
  const cityS = el('select', { onchange: e => { filterState.city = e.target.value; refresh(); } },
    [el('option', { value:'' }, 'Все города')].concat(cities.map(c => el('option', { value: c }, c))));

  const tw = el('div', { class: 'table-wrap' });
  tw.append(el('div', { class: 'table-toolbar' }, [
    searchI, typeS, cityS,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm', onclick: () => exportClientsCSV() }, 'Экспорт CSV'),
  ]));

  function refresh() {
    const visible = state.clients.filter(c => {
      if (filterState.q && !(c.name+c.bin+c.contact).toLowerCase().includes(filterState.q)) return false;
      if (filterState.type && c.type !== filterState.type) return false;
      if (filterState.city && c.city !== filterState.city) return false;
      return true;
    });
    const tb = tw.querySelector('tbody');
    if (tb) tb.replaceWith(buildTbody(visible));
  }
  function buildTbody(list) {
    return el('tbody', {}, list.map(c => {
      const m = userById(c.manager);
      const ct = CLIENT_TYPES[c.type] || { label: '—', color: '#999' };
      return el('tr', { onclick: () => openClientDetail(c.id) }, [
        el('td', {}, [
          el('div', { class:'strong' }, c.name),
          el('div', { class:'muted' }, c.contact + ' · ' + c.phone),
        ]),
        el('td', {}, el('span', { class:'muted', style:'font-variant-numeric:tabular-nums' }, c.bin)),
        el('td', {}, el('span', { class:'pill', style:`background:${ct.color}22;color:${ct.color}` }, ct.label)),
        el('td', {}, c.city),
        el('td', {}, el('div', { class:'row' }, [
          el('span', { class:'avatar', style:`width:22px;height:22px;font-size:10px;background:${m.color}` }, m.avatar),
          el('span', { style:'font-size:12px' }, m.name.split(' ')[0]),
        ])),
        el('td', { class:'num strong' }, fmtMoneyK(c.ltv)),
        el('td', { class:'num' }, c.balance < 0
          ? el('span', { class:'pill pill-danger' }, fmtMoneyK(c.balance))
          : el('span', { class:'muted' }, '0')),
        el('td', { class:'muted' }, fmtDate(c.lastDeal)),
      ]);
    }));
  }

  const t = el('table', { class: 'data' });
  t.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Клиент'),
    el('th', {}, 'БИН'),
    el('th', {}, 'Тип'),
    el('th', {}, 'Город'),
    el('th', {}, 'Менеджер'),
    el('th', { class: 'num' }, 'LTV'),
    el('th', { class: 'num' }, 'Баланс'),
    el('th', {}, 'Последняя сделка'),
  ])));
  t.append(buildTbody(state.clients));

  tw.append(t);
  wrap.append(tw);
  return wrap;
};

function openClientDetail(id) {
  const c = byId(state.clients, id);
  if (!c) return;
  const dealsOf = state.deals.filter(d => d.client === id);
  const body = el('div', {}, [
    el('dl', { class:'kv' }, [
      el('dt', {}, 'Наименование'), el('dd', { class:'strong' }, c.name),
      el('dt', {}, 'БИН/ИИН'),       el('dd', {}, c.bin),
      el('dt', {}, 'Тип'),            el('dd', {}, (CLIENT_TYPES[c.type]||{}).label || '—'),
      el('dt', {}, 'Контактное лицо'), el('dd', {}, c.contact),
      el('dt', {}, 'Телефон'),        el('dd', {}, c.phone),
      el('dt', {}, 'Email'),           el('dd', {}, c.email),
      el('dt', {}, 'Город'),           el('dd', {}, c.city),
      el('dt', {}, 'Адрес'),           el('dd', {}, c.address),
      el('dt', {}, 'LTV'),             el('dd', { class:'strong' }, fmtMoney(c.ltv)),
      el('dt', {}, 'Баланс'),          el('dd', {}, c.balance < 0
                                          ? el('span', { class:'pill pill-danger' }, 'Долг ' + fmtMoney(-c.balance))
                                          : el('span', { class:'pill pill-success' }, 'Расчётов нет')),
    ]),
    el('div', { style:'font-weight:600;margin:16px 0 8px' }, `Сделки (${dealsOf.length})`),
    el('table', { class:'data' }, el('tbody', {}, dealsOf.length
      ? dealsOf.map(d => {
          const s = stageById(d.stage);
          return el('tr', { onclick: () => { closeModal(); openDealDetail(d.id); } }, [
            el('td', {}, '№' + d.no),
            el('td', {}, d.title),
            el('td', {}, el('span', { class:'pill', style:`background:${s.color}22;color:${s.color}` }, s.label)),
            el('td', { class:'num strong' }, fmtMoneyK(d.amount)),
          ]);
        })
      : [el('tr', {}, el('td', { colspan: 4, class:'muted', style:'text-align:center;padding:20px' }, 'Сделок ещё нет'))])),
  ]);
  openModal({
    title: c.name,
    body,
    foot: [
      el('button', { class:'btn', onclick: () => stub('Редактирование клиента', 'Здесь форма правок реквизитов, контактов, тегов и заметок. Изменения логируются.') }, '✏️ Редактировать'),
      el('button', { class:'btn btn-primary', onclick: () => { closeModal(); openNewDeal(); toast('Подставлю клиента в новую сделку', 'info'); } }, '+ Сделка'),
    ],
  });
}

// ============================================================
// VIEW: CATALOG
// ============================================================
VIEWS.catalog = () => {
  const wrap = el('div');
  const sub = el('div', { class: 'sub' }, 'Загрузка…');
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', {}, 'Каталог номенклатуры'), sub]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => openImport('products') }, '📥 Импорт прайса EKF'),
      el('button', { class: 'btn btn-primary', onclick: openNewProduct }, '+ Товар'),
    ]),
  ]));

  const q = { q: '', category: '', brand: '', page: 1, limit: 50, total: 0 };

  // Категории (серверный подсчёт)
  wrap.append(el('div', { style:'font-weight:600;margin:8px 0 12px;font-size:14px' }, 'Категории'));
  const tilesHost = el('div', { class: 'cat-grid' });
  wrap.append(tilesHost);

  // Тулбар: поиск + бренд
  const searchI = el('input', { placeholder:'Поиск по артикулу или названию…' });
  const brandSel = el('select', {},
    [el('option', { value:'' }, 'Все бренды'), el('option', { value:'EKF' }, 'EKF'), el('option', { value:'KazКабель' }, 'KazКабель'), el('option', { value:'WAGO' }, 'WAGO'), el('option', { value:'КВТ' }, 'КВТ')]);
  const tw = el('div', { class: 'table-wrap' });
  tw.append(el('div', { class: 'table-toolbar' }, [searchI, brandSel]));
  const tableHost = el('div');
  tw.append(tableHost);
  wrap.append(tw);
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' });
  wrap.append(pager);

  let deb;
  searchI.oninput = (e) => { clearTimeout(deb); const v = e.target.value; deb = setTimeout(() => { q.q = v; q.page = 1; loadProducts(); }, 300); };
  brandSel.onchange = (e) => { q.brand = e.target.value; q.page = 1; loadProducts(); };

  async function loadCats() {
    try {
      const resp = await window.__API__.apiFetch('catalog/categories');
      const cats = resp.categories || resp || [];
      const total = resp.total != null ? resp.total : cats.reduce((s, c) => s + c.count, 0);
      tilesHost.innerHTML = '';
      const mkTile = (id, icon, name, count) => el('div', { class: 'cat-tile' + (q.category === id ? ' active' : ''), onclick: () => { q.category = id; q.page = 1; loadCats(); loadProducts(); wrap.querySelector('.table-wrap') && wrap.querySelector('.table-wrap').scrollIntoView({ behavior:'smooth', block:'start' }); } }, [
        el('div', { class:'cat-icon' }, icon), el('div', { class:'cat-name' }, name), el('div', { class:'cat-count' }, count + ' SKU'),
      ]);
      tilesHost.append(mkTile('', '🗂', 'Все товары', total));
      cats.forEach(c => tilesHost.append(mkTile(c.id, c.icon || '📁', c.name, c.count)));
    } catch (e) { tilesHost.innerHTML = ''; tilesHost.append(el('div', { class:'muted' }, 'Категории недоступны')); }
  }

  async function loadProducts() {
    tableHost.innerHTML = ''; tableHost.append(el('div', { class:'muted', style:'padding:14px' }, 'Загрузка…'));
    try {
      const qs = `q=${encodeURIComponent(q.q)}&category=${encodeURIComponent(q.category)}&brand=${encodeURIComponent(q.brand)}&page=${q.page}&limit=${q.limit}`;
      const r = await window.__API__.apiFetch('products?' + qs);
      q.total = r.total || 0;
      sub.textContent = `${q.total} позиций` + (q.category ? ' в категории' : '');
      const t = el('table', { class:'data' });
      t.append(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Артикул'), el('th', {}, 'Наименование'), el('th', {}, 'Бренд'),
        el('th', { class:'num' }, 'Закуп'), el('th', { class:'num' }, 'Опт'), el('th', { class:'num' }, 'Розница'), el('th', {}, 'Остаток'),
      ])));
      const rows = (r.data || []).map(row => {
        const p = window.__API__.map.product(row);
        return el('tr', { onclick: () => openProductDetail(p) }, [
          el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, p.sku),
          el('td', { class:'strong' }, p.image
            ? el('span', { style:'display:inline-flex;align-items:center;gap:8px' }, [el('img', { src:p.image, alt:'', style:'width:28px;height:28px;object-fit:cover;border-radius:4px;border:1px solid #E5E7EB' }), p.name])
            : p.name),
          el('td', {}, el('span', { class:'tag' }, p.brand || '—')),
          el('td', { class:'num strong' }, p.priceCost ? fmtMoney(p.priceCost) : '—'),
          el('td', { class:'num muted' }, p.priceWholesale ? fmtMoney(p.priceWholesale) : '—'),
          el('td', { class:'num muted' }, p.priceRetail ? fmtMoney(p.priceRetail) : '—'),
          el('td', {}, stockIndicator(p.stock - p.reserved, p.stock)),
        ]);
      });
      t.append(el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: 7, class:'muted', style:'text-align:center;padding:24px' }, 'Ничего не найдено'))]));
      tableHost.innerHTML = ''; tableHost.append(t);
      renderPager();
    } catch (e) { tableHost.innerHTML = ''; tableHost.append(el('div', { class:'pill pill-danger' }, 'Ошибка загрузки: ' + ((e && e.message) || e))); }
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(q.total / q.limit));
    pager.innerHTML = '';
    pager.append(
      el('div', { class:'muted', style:'font-size:12px' }, `Найдено: ${q.total} · стр. ${q.page} из ${pages}`),
      el('div', { class:'row', style:'gap:6px' }, [
        el('button', { class:'btn btn-sm', disabled: q.page <= 1 ? 'disabled' : null, onclick: () => { if (q.page > 1) { q.page--; loadProducts(); } } }, '← Назад'),
        el('button', { class:'btn btn-sm', disabled: q.page >= pages ? 'disabled' : null, onclick: () => { if (q.page < pages) { q.page++; loadProducts(); } } }, 'Вперёд →'),
      ]),
    );
  }

  loadCats();
  loadProducts();
  return wrap;
};

// ============================================================
// VIEW: WAREHOUSE
// ============================================================
VIEWS.warehouse = () => {
  const wrap = el('div');

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Склад'),
      el('div', { class: 'sub' }, 'Карагандинский склад · ул. Бытовая, 13/1'),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => { wrap.querySelector('[data-anchor="receipts"]')?.scrollIntoView({ behavior:'smooth' }); toast('Скроллю к приходам', 'info'); } }, '📦 Приходы'),
      el('button', { class: 'btn', onclick: () => stub('Перемещения между складами', 'У KES пока один склад в Караганде. При расширении: складки в Астане, Алматы, Темиртау — перемещения с актами М-11.') }, '🔄 Перемещения'),
      can('edit-stock') ? el('button', { class: 'btn btn-primary', onclick: () => openInventoryCreate() }, '+ Инвентаризация') : null,
    ]),
  ]));

  // Сводка по складу (серверный подсчёт по всем товарам)
  const stats = el('div', { class:'grid grid-4' }, [
    statCard('SKU на складе', '…', '', '', '📦'),
    statCard('Всего единиц', '…', '', '', '🧮'),
    statCard('Зарезервировано', '…', '', '', '🔒'),
    statCard('Стоимость склада', '…', '', '', '💎'),
  ]);
  wrap.append(stats);
  window.__API__.apiFetch('warehouse/summary').then(s => {
    const grid = el('div', { class:'grid grid-4' }, [
      statCard('SKU на складе', (s.sku || 0).toLocaleString('ru-RU'), '', '', '📦'),
      statCard('Всего единиц', Math.round(s.units || 0).toLocaleString('ru-RU'), '', '', '🧮'),
      statCard('Зарезервировано', Math.round(s.reserved || 0).toLocaleString('ru-RU'), '', '', '🔒'),
      statCard('Стоимость склада', fmtMoneyK(s.value || 0), '', '', '💎'),
    ]);
    stats.replaceWith(grid);
  }).catch(() => {});

  // Инвентаризации (документы пересчёта)
  if (can('edit-stock')) {
    wrap.append(el('div', { style:'font-weight:600;margin:24px 0 12px' }, 'Инвентаризации'));
    const invHost = el('div', { class:'table-wrap' }, el('div', { class:'muted', style:'padding:12px' }, 'Загрузка…'));
    wrap.append(invHost);
    renderInventoryList(invHost);
  }

  // Остатки по складу — серверная пагинация + поиск + фильтр низких остатков
  wrap.append(el('div', { style:'font-weight:600;margin:24px 0 12px' }, 'Остатки по складу'));
  const q = { q: '', low: false, page: 1, limit: 50, total: 0 };
  const searchI = el('input', { placeholder:'Поиск по артикулу или названию…' });
  const lowChk = el('input', { type:'checkbox' });
  const lowLabel = el('label', { style:'display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#374151;white-space:nowrap' }, [lowChk, 'Только низкие остатки (<50)']);
  const tw = el('div', { class: 'table-wrap' });
  tw.append(el('div', { class: 'table-toolbar' }, [searchI, lowLabel]));
  const tableHost = el('div');
  tw.append(tableHost);
  wrap.append(tw);
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' });
  wrap.append(pager);

  let deb;
  searchI.oninput = (e) => { clearTimeout(deb); const v = e.target.value; deb = setTimeout(() => { q.q = v; q.page = 1; loadStock(); }, 300); };
  lowChk.onchange = (e) => { q.low = e.target.checked; q.page = 1; loadStock(); };

  async function loadStock() {
    tableHost.innerHTML = ''; tableHost.append(el('div', { class:'muted', style:'padding:14px' }, 'Загрузка…'));
    try {
      const qs = `q=${encodeURIComponent(q.q)}&page=${q.page}&limit=${q.limit}` + (q.low ? '&lowstock=50' : '');
      const r = await window.__API__.apiFetch('products?' + qs);
      q.total = r.total || 0;
      const t = el('table', { class:'data' });
      t.append(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Артикул'), el('th', {}, 'Товар'),
        el('th', { class:'num' }, 'Остаток'), el('th', { class:'num' }, 'Резерв'),
        el('th', { class:'num' }, 'Свободно'), el('th', { class:'num' }, 'Закуп'),
      ])));
      const rows = (r.data || []).map(row => {
        const p = window.__API__.map.product(row);
        const free = p.stock - p.reserved;
        return el('tr', { onclick: () => openProductDetail(p) }, [
          el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, p.sku),
          el('td', { class:'strong' }, p.name),
          el('td', { class:'num' }, p.stock),
          el('td', { class:'num muted' }, p.reserved),
          el('td', { class:'num' }, stockIndicator(free, p.stock)),
          el('td', { class:'num' }, p.priceCost ? fmtMoney(p.priceCost) : '—'),
        ]);
      });
      t.append(el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: 6, class:'muted', style:'text-align:center;padding:24px' }, q.low ? 'Низких остатков нет' : 'Ничего не найдено'))]));
      tableHost.innerHTML = ''; tableHost.append(t);
      renderPager();
    } catch (e) { tableHost.innerHTML = ''; tableHost.append(el('div', { class:'pill pill-danger' }, 'Ошибка загрузки: ' + ((e && e.message) || e))); }
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(q.total / q.limit));
    pager.innerHTML = '';
    pager.append(
      el('div', { class:'muted', style:'font-size:12px' }, `Найдено: ${q.total} · стр. ${q.page} из ${pages}`),
      el('div', { class:'row', style:'gap:6px' }, [
        el('button', { class:'btn btn-sm', disabled: q.page <= 1 ? 'disabled' : null, onclick: () => { if (q.page > 1) { q.page--; loadStock(); } } }, '← Назад'),
        el('button', { class:'btn btn-sm', disabled: q.page >= pages ? 'disabled' : null, onclick: () => { if (q.page < pages) { q.page++; loadStock(); } } }, 'Вперёд →'),
      ]),
    );
  }

  // Последние приходы
  wrap.append(el('div', { 'data-anchor': 'receipts', style:'font-weight:600;margin:24px 0 12px' }, 'Последние приходы от поставщиков'));
  const t = el('div', { class:'table-wrap' });
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, '№ накладной'),
    el('th', {}, 'Дата'),
    el('th', {}, 'Поставщик'),
    el('th', { class:'num' }, 'Позиций'),
    el('th', { class:'num' }, 'Сумма'),
    el('th', {}, 'Статус'),
    el('th', {}, 'Примечание'),
  ])));
  const recentReceipts = state.receipts.slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 20);
  tab.append(el('tbody', {}, recentReceipts.length ? recentReceipts.map(r => {
    const supplier = r.supplierName || (byId(state.suppliers, r.supplier) || {}).name || '—';
    return el('tr', {}, [
      el('td', { class:'strong' }, r.no),
      el('td', {}, fmtDate(r.date)),
      el('td', {}, supplier),
      el('td', { class:'num' }, r.items),
      el('td', { class:'num strong' }, fmtMoneyK(r.amount)),
      el('td', {}, el('span', { class: 'pill ' + (r.status === 'оприходовано' ? 'pill-success' : 'pill-warn') }, r.status)),
      el('td', { class:'muted' }, r.note),
    ]);
  }) : [el('tr', {}, el('td', { colspan: 7, class:'muted', style:'text-align:center;padding:16px' }, 'Приходов нет. Синхронизируйте из 1С в Настройках.'))]));
  t.append(tab);
  wrap.append(t);

  loadStock();
  return wrap;
};

// ============================================================
// ИНВЕНТАРИЗАЦИЯ
// ============================================================

// Список документов инвентаризации в разделе «Склад»
async function renderInventoryList(host) {
  try {
    const rows = await window.__API__.apiFetch('inventory');
    host.innerHTML = '';
    if (!rows || !rows.length) {
      host.append(el('div', { class:'muted', style:'padding:12px' }, 'Инвентаризаций пока нет. Нажмите «+ Инвентаризация».'));
      return;
    }
    const t = el('table', { class:'data' });
    t.append(el('thead', {}, el('tr', {}, [
      el('th', {}, '№'), el('th', {}, 'Дата'), el('th', {}, 'Охват'),
      el('th', { class:'num' }, 'Позиций'), el('th', {}, 'Статус'),
      el('th', { class:'num' }, 'Излишки'), el('th', { class:'num' }, 'Недостача'),
    ])));
    const scopeLabel = { all:'Вся номенклатура', instock:'С остатком', category:'По категории' };
    t.append(el('tbody', {}, rows.map(r => el('tr', { style:'cursor:pointer', onclick: () => openInventorySheet(r.id) }, [
      el('td', { class:'strong' }, r.no),
      el('td', {}, String(r.date || '').slice(0, 16).replace('T', ' ')),
      el('td', { class:'muted' }, scopeLabel[r.scope] || r.scope || '—'),
      el('td', { class:'num' }, r.items_count || 0),
      el('td', {}, r.status === 'posted'
        ? el('span', { class:'pill pill-success' }, 'проведена')
        : el('span', { class:'pill pill-warn' }, 'черновик')),
      el('td', { class:'num' }, r.surplus_value ? fmtMoneyK(r.surplus_value) : '—'),
      el('td', { class:'num' }, r.shortage_value ? fmtMoneyK(r.shortage_value) : '—'),
    ]))));
    host.append(t);
  } catch (e) {
    host.innerHTML = '';
    host.append(el('div', { class:'pill pill-danger', style:'margin:8px' }, 'Не удалось загрузить инвентаризации: ' + ((e && e.message) || e)));
  }
}

// Модалка создания: выбор охвата листа пересчёта
function openInventoryCreate() {
  const cats = (state.categories || []).filter(c => c.name !== 'Товары');
  const scope = fSelect('Охват пересчёта', [
    { value:'instock', label:'Только товары с остатком' },
    { value:'category', label:'По категории' },
    { value:'all', label:'Вся номенклатура (большой лист)' },
  ], 'instock');
  const cat = fSelect('Категория', cats.length ? cats.map(c => ({ value:c.id, label:`${c.icon || '📁'} ${c.name} (${c.count || 0})` })) : [{ value:'', label:'— нет категорий —' }]);
  const note = fInput('Примечание', '', { placeholder:'необязательно' });
  cat.row.style.display = 'none';
  scope.row.querySelector('select').onchange = (e) => { cat.row.style.display = e.target.value === 'category' ? '' : 'none'; };
  const body = el('div', {}, [
    scope.row, cat.row, note.row,
    el('p', { class:'muted', style:'font-size:12px;margin:4px 0 0' }, 'Будет создан лист пересчёта со снимком учётных остатков. Дальше — сканер или печать листа.'),
  ]);
  const createBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    if (scope.get() === 'category' && !cat.get()) { toast('Выберите категорию', 'warn'); return; }
    createBtn.disabled = true; createBtn.textContent = 'Создаём…';
    try {
      const r = await window.__API__.apiFetch('inventory', { method:'POST', body: {
        scope: scope.get(),
        category: scope.get() === 'category' ? cat.get() : undefined,
        note: note.get(),
      } });
      toast(`Лист создан: ${r.no} · ${r.items_count} позиций`, 'success');
      closeModal();
      openInventorySheet(r.id);
    } catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); createBtn.disabled = false; createBtn.textContent = 'Создать лист'; }
  } }, 'Создать лист');
  openModal({ title:'Новая инвентаризация', body, foot: [el('button', { class:'btn', onclick: closeModal }, 'Отмена'), createBtn] });
}

// Лист пересчёта: сканер + ручной ввод + сохранение + печать + проведение
async function openInventorySheet(id) {
  openModal({ title:'Лист пересчёта', body: el('div', { class:'muted', style:'padding:20px' }, 'Загрузка…'), foot: [] });
  let doc;
  try { doc = await window.__API__.apiFetch('inventory/' + encodeURIComponent(id)); }
  catch (e) { toast('Ошибка загрузки: ' + ((e && e.message) || e), 'error'); return; }

  const items = (doc.items || []).map(it => ({ ...it, counted: it.counted == null ? null : Number(it.counted) }));
  const bySku = {}; items.forEach(it => { bySku[String(it.sku || '').trim().toLowerCase()] = it; });
  const posted = doc.status === 'posted';
  let dirty = false;

  const diffOf = (it) => (it.counted == null ? null : it.counted - Number(it.expected || 0));
  const fmtDiff = (d) => d == null ? '—' : (d > 0 ? '+' + d : String(d));

  // --- toolbar ---
  const scanI = el('input', { placeholder:'📷 Сканируйте или введите артикул + Enter', style:'flex:1;min-width:180px' });
  const searchI = el('input', { placeholder:'Поиск по списку…', style:'flex:1;min-width:140px' });
  const filterSel = el('select', {}, [
    el('option', { value:'all' }, 'Все'),
    el('option', { value:'todo' }, 'Не пересчитанные'),
    el('option', { value:'diff' }, 'С расхождением'),
  ]);
  const progress = el('div', { class:'muted', style:'font-size:12px;margin:6px 0' });
  const tbody = el('tbody', {});

  function updateProgress() {
    const counted = items.filter(it => it.counted != null).length;
    const diffs = items.filter(it => { const d = diffOf(it); return d != null && d !== 0; }).length;
    progress.innerHTML = '';
    progress.append(
      el('span', {}, `Пересчитано ${counted} из ${items.length}`),
      el('span', { style:'margin-left:12px' }, `Расхождений: `),
      el('b', { style: diffs ? 'color:#DC2626' : 'color:#16A34A' }, String(diffs)),
      dirty ? el('span', { class:'pill pill-warn', style:'margin-left:10px;font-size:10px' }, 'есть несохранённое') : null,
    );
  }
  function updateRowUI(it) {
    const inp = tbody.querySelector(`[data-fact="${it.product_id}"]`);
    if (inp && document.activeElement !== inp) inp.value = it.counted == null ? '' : it.counted;
    const dc = tbody.querySelector(`[data-delta="${it.product_id}"]`);
    if (dc) { const d = diffOf(it); dc.textContent = fmtDiff(d); dc.style.color = d == null ? '#9CA3AF' : d === 0 ? '#6B7280' : d > 0 ? '#16A34A' : '#DC2626'; }
  }

  function visible() {
    const q = searchI.value.trim().toLowerCase();
    const f = filterSel.value;
    return items.filter(it => {
      if (q && !(String(it.sku || '').toLowerCase().includes(q) || String(it.name || '').toLowerCase().includes(q))) return false;
      if (f === 'todo' && it.counted != null) return false;
      if (f === 'diff') { const d = diffOf(it); if (d == null || d === 0) return false; }
      return true;
    });
  }
  function renderList() {
    const list = visible();
    const cap = 400;
    tbody.innerHTML = '';
    list.slice(0, cap).forEach(it => {
      const d = diffOf(it);
      const factInput = el('input', {
        type:'number', 'data-fact': it.product_id, value: it.counted == null ? '' : it.counted,
        style:'width:80px', disabled: posted ? 'disabled' : null,
        oninput: (e) => {
          const v = e.target.value;
          it.counted = (v === '' ? null : Number(v));
          dirty = true;
          updateRowUI(it); updateProgress();
        },
      });
      tbody.append(el('tr', {}, [
        el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, it.sku),
        el('td', { class:'strong' }, it.name),
        el('td', { class:'num' }, Math.round(Number(it.expected || 0) * 100) / 100),
        el('td', { class:'num' }, factInput),
        el('td', { class:'num', 'data-delta': it.product_id, style:`font-weight:600;color:${d == null ? '#9CA3AF' : d === 0 ? '#6B7280' : d > 0 ? '#16A34A' : '#DC2626'}` }, fmtDiff(d)),
      ]));
    });
    if (list.length > cap) tbody.append(el('tr', {}, el('td', { colspan:5, class:'muted', style:'text-align:center;padding:10px' }, `Показаны первые ${cap} из ${list.length}. Уточните поиск или используйте сканер.`)));
    if (!list.length) tbody.append(el('tr', {}, el('td', { colspan:5, class:'muted', style:'text-align:center;padding:14px' }, 'Ничего не найдено')));
  }

  scanI.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = scanI.value.trim();
    if (!raw) return;
    // поддержка «артикул*кол-во» (например 12 единиц одним сканом)
    const m = raw.match(/^(.*?)\s*[*xх]\s*(\d+(?:[.,]\d+)?)$/i);
    const sku = (m ? m[1] : raw).trim().toLowerCase();
    const add = m ? Number(String(m[2]).replace(',', '.')) : 1;
    const it = bySku[sku];
    scanI.value = '';
    if (!it) { toast(`Артикул не найден: ${raw}`, 'warn'); return; }
    it.counted = (it.counted || 0) + add;
    dirty = true;
    updateRowUI(it); updateProgress();
    toast(`${it.sku}: ${it.counted}`, 'success');
  };
  let sd; searchI.oninput = () => { clearTimeout(sd); sd = setTimeout(renderList, 200); };
  filterSel.onchange = renderList;

  async function save() {
    const payload = { items: items.map(it => ({ product_id: it.product_id, counted: it.counted })) };
    await window.__API__.apiFetch('inventory/' + encodeURIComponent(id) + '/items', { method:'PUT', body: payload });
    dirty = false; updateProgress();
  }

  // --- сборка тела ---
  const table = el('table', { class:'data' });
  table.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Артикул'), el('th', {}, 'Наименование'),
    el('th', { class:'num' }, 'Учёт'), el('th', { class:'num' }, 'Факт'), el('th', { class:'num' }, 'Δ'),
  ])));
  table.append(tbody);

  const body = el('div', {}, [
    el('div', { class:'row', style:'gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px' }, [
      el('span', { class:'pill' }, doc.no),
      posted ? el('span', { class:'pill pill-success' }, 'проведена') : el('span', { class:'pill pill-warn' }, 'черновик'),
      doc.responsible_name ? el('span', { class:'muted', style:'font-size:12px' }, '👤 ' + doc.responsible_name) : null,
    ]),
    posted ? null : el('div', { class:'row', style:'gap:8px;flex-wrap:wrap;margin:8px 0' }, [scanI, searchI, filterSel]),
    posted ? el('div', { class:'row', style:'gap:8px;flex-wrap:wrap;margin:8px 0' }, [searchI, filterSel]) : null,
    progress,
    el('div', { style:'max-height:48vh;overflow:auto;border:1px solid #E5E7EB;border-radius:8px' }, table),
  ]);

  // --- кнопки ---
  const foot = [];
  foot.push(el('button', { class:'btn', onclick: () => printCountSheet(doc, items) }, '🖨 Печать листа'));
  if (posted) {
    foot.push(el('button', { class:'btn', onclick: () => printInventoryAct(doc, items, 'shortage') }, '📄 Акт списания'));
    foot.push(el('button', { class:'btn', onclick: () => printInventoryAct(doc, items, 'surplus') }, '📄 Акт оприходования'));
    foot.push(el('button', { class:'btn btn-primary', onclick: () => { closeModal(); navigate('warehouse'); } }, 'Закрыть'));
  } else {
    const saveBtn = el('button', { class:'btn', onclick: async () => {
      saveBtn.disabled = true; const o = saveBtn.textContent; saveBtn.textContent = 'Сохраняем…';
      try { await save(); toast('Сохранено', 'success'); } catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); }
      saveBtn.disabled = false; saveBtn.textContent = o;
    } }, '💾 Сохранить');
    const postBtn = el('button', { class:'btn btn-primary', onclick: async () => {
      const counted = items.filter(it => it.counted != null).length;
      if (!counted) { toast('Внесите фактические количества хотя бы для одной позиции', 'warn'); return; }
      if (!confirm(`Провести инвентаризацию?\nОстатки на складе будут выставлены по факту (${counted} позиций). Действие необратимо.`)) return;
      postBtn.disabled = true; postBtn.textContent = 'Проведение…';
      try {
        await save();
        const res = await window.__API__.apiFetch('inventory/' + encodeURIComponent(id) + '/post', { method:'POST' });
        showInventoryResult(doc, items, res);
      } catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); postBtn.disabled = false; postBtn.textContent = '✅ Сравнить и провести'; }
    } }, '✅ Сравнить и провести');
    foot.push(saveBtn, postBtn);
  }

  openModal({ title:'Инвентаризация ' + doc.no, body, foot });
  renderList(); updateProgress();
  if (!posted) setTimeout(() => scanI.focus(), 50);
}

// Итог проведения: сводка расхождений + печать актов
function showInventoryResult(doc, items, res) {
  const shortage = items.filter(it => it.counted != null && it.counted < Number(it.expected || 0));
  const surplus = items.filter(it => it.counted != null && it.counted > Number(it.expected || 0));
  const body = el('div', {}, [
    el('p', {}, 'Инвентаризация проведена, остатки на складе обновлены по факту.'),
    el('div', { class:'grid grid-2', style:'gap:10px;margin:10px 0' }, [
      el('div', { class:'card', style:'padding:12px' }, [
        el('div', { class:'stat-label' }, 'Излишки (оприходование)'),
        el('div', { style:'font-size:18px;font-weight:600;margin-top:4px;color:#16A34A' }, `${surplus.length} поз · ${fmtMoney(res.surplusValue || 0)}`),
      ]),
      el('div', { class:'card', style:'padding:12px' }, [
        el('div', { class:'stat-label' }, 'Недостача (списание)'),
        el('div', { style:'font-size:18px;font-weight:600;margin-top:4px;color:#DC2626' }, `${shortage.length} поз · ${fmtMoney(res.shortageValue || 0)}`),
      ]),
    ]),
    el('p', { class:'muted', style:'font-size:12px' }, 'Распечатайте акты для оформления.'),
  ]);
  openModal({ title:'Результат инвентаризации', body, foot: [
    el('button', { class:'btn', onclick: () => printInventoryAct(doc, items, 'shortage'), disabled: shortage.length ? null : 'disabled' }, '📄 Акт списания'),
    el('button', { class:'btn', onclick: () => printInventoryAct(doc, items, 'surplus'), disabled: surplus.length ? null : 'disabled' }, '📄 Акт оприходования'),
    el('button', { class:'btn btn-primary', onclick: () => { closeModal(); navigate('warehouse'); } }, 'Готово'),
  ] });
}

// Печать инвентаризационного листа (слепой пересчёт — без учётных данных)
function printCountSheet(doc, items) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  const dateStr = String(doc.date || '').slice(0, 10);
  const rows = items.map((it, i) =>
    `<tr><td>${i + 1}</td><td style="font-family:monospace;font-size:11px">${it.sku || ''}</td><td>${it.name || ''}</td><td style="width:120px;border-bottom:1px solid #999">&nbsp;</td></tr>`
  ).join('');
  const inner = `
    <div class="pr-head">
      <div class="pr-logo">${PRINT_LOGO}<div><h2>ИНВЕНТАРИЗАЦИОННЫЙ ЛИСТ ${doc.no}</h2><div style="color:#666;font-size:12px;margin-top:4px">от ${dateStr} · лист пересчёта</div></div></div>
      <div class="pr-meta"><div>ТОО «KazEnergoSnab»</div><div>Склад: Караганда</div><div style="margin-top:6px;color:#888">Ответственный: ${doc.responsible_name || '____________'}</div></div>
    </div>
    <table class="pr-table"><thead><tr><th style="width:32px">#</th><th style="width:110px">Артикул</th><th>Наименование</th><th class="num" style="width:120px">Факт</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="pr-foot">
      <div><div>Пересчёт произвёл: ____________________</div><div style="margin-top:12px">Проверил: ____________________</div><div style="margin-top:4px;color:#aaa">М.П.</div></div>
      <div class="pr-stamp">место<br>печати</div>
    </div>`;
  w.document.open(); w.document.write(buildPrintDoc('Лист ' + doc.no, inner)); w.document.close();
}

// Печать акта: 'shortage' = списание (недостача), 'surplus' = оприходование (излишки)
function printInventoryAct(doc, items, kind) {
  const isShort = kind === 'shortage';
  const list = items.filter(it => it.counted != null && (isShort ? it.counted < Number(it.expected || 0) : it.counted > Number(it.expected || 0)));
  if (!list.length) { toast(isShort ? 'Недостач нет' : 'Излишков нет', 'info'); return; }
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  const dateStr = String(doc.posted_at || doc.date || '').slice(0, 10);
  let total = 0;
  const rows = list.map((it, i) => {
    const diff = Math.abs(it.counted - Number(it.expected || 0));
    const sum = diff * Number(it.price_cost || 0);
    total += sum;
    return `<tr><td>${i + 1}</td><td style="font-family:monospace;font-size:11px">${it.sku || ''}</td><td>${it.name || ''}</td>`
      + `<td class="num">${Math.round(Number(it.expected || 0) * 100) / 100}</td><td class="num">${it.counted}</td>`
      + `<td class="num"><b>${isShort ? '−' : '+'}${diff}</b></td><td class="num">${fmtMoney(it.price_cost || 0)}</td><td class="num"><b>${fmtMoney(sum)}</b></td></tr>`;
  }).join('');
  const title = isShort ? 'АКТ СПИСАНИЯ (недостача)' : 'АКТ ОПРИХОДОВАНИЯ (излишки)';
  const inner = `
    <div class="pr-head">
      <div class="pr-logo">${PRINT_LOGO}<div><h2>${title}</h2><div style="color:#666;font-size:12px;margin-top:4px">по инвентаризации ${doc.no} от ${dateStr}</div></div></div>
      <div class="pr-meta"><div>ТОО «KazEnergoSnab»</div><div>Склад: Караганда</div><div style="margin-top:6px;color:#888">Ответственный: ${doc.responsible_name || '____________'}</div></div>
    </div>
    <table class="pr-table"><thead><tr><th style="width:32px">#</th><th style="width:100px">Артикул</th><th>Наименование</th><th class="num">Учёт</th><th class="num">Факт</th><th class="num">Откл.</th><th class="num">Закуп</th><th class="num">Сумма</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="pr-totals"><div class="total-line grand"><span>Итого ${isShort ? 'недостача' : 'излишки'}:</span> <span>${fmtMoney(total)}</span></div></div>
    <div class="pr-foot">
      <div><div>Председатель комиссии: ____________________</div><div style="margin-top:12px">Члены комиссии: ____________________</div><div style="margin-top:12px">МОЛ: ____________________</div><div style="margin-top:4px;color:#aaa">М.П.</div></div>
      <div class="pr-stamp">место<br>печати</div>
    </div>`;
  w.document.open(); w.document.write(buildPrintDoc(title + ' ' + doc.no, inner)); w.document.close();
}

// ============================================================
// VIEW: SHIPMENTS
// ============================================================
VIEWS.shipments = () => {
  const wrap = el('div');
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Отгрузки'),
      el('div', { class: 'sub' }, `${state.shipments.length} отгрузок в работе`),
    ]),
    el('div', { class: 'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewShipment }, '+ Отгрузка')]),
  ]));

  const t = el('div', { class:'table-wrap' });
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, '№ ТТН'),
    el('th', {}, 'Дата'),
    el('th', {}, 'Клиент'),
    el('th', {}, 'Куда'),
    el('th', {}, 'Транспорт / водитель'),
    el('th', { class:'num' }, 'Позиций'),
    el('th', { class:'num' }, 'Вес, кг'),
    el('th', {}, 'Статус'),
  ])));
  tab.append(el('tbody', {}, state.shipments.map(s => {
    const cl = clientById(s.client);
    return el('tr', { onclick: () => openShipmentDetail(s.id) }, [
      el('td', { class:'strong' }, s.no),
      el('td', {}, fmtDate(s.date)),
      el('td', {}, cl.name),
      el('td', { class:'muted' }, s.destination),
      el('td', {}, [s.transport, el('div', { class:'muted', style:'font-size:11.5px' }, s.driver)]),
      el('td', { class:'num' }, s.items),
      el('td', { class:'num' }, s.weight),
      el('td', {}, s.status === 'delivered'
        ? el('span', { class:'pill pill-success' }, '✓ Доставлено')
        : s.status === 'planned'
          ? el('span', { class:'pill pill-info' }, '⏱ Запланировано')
          : el('span', { class:'pill pill-warn' }, '🚚 В пути')),
    ]);
  })));
  t.append(tab);
  wrap.append(t);
  return wrap;
};

// ============================================================
// VIEW: INVOICES / DOCS
// ============================================================
VIEWS.invoices = () => {
  const wrap = el('div');
  const totalPaid = state.invoices.filter(i => i.status === 'paid').reduce((s,i)=>s+i.amount,0);
  const totalDue = state.invoices.filter(i => i.status !== 'paid').reduce((s,i)=>s+i.amount,0);

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Документы'),
      el('div', { class: 'sub' }, 'Счета-фактуры, накладные, договоры'),
    ]),
    el('div', { class: 'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewInvoice }, '+ Счёт')]),
  ]));

  wrap.append(el('div', { class:'grid grid-3' }, [
    statCard('Оплачено',         fmtMoneyK(totalPaid),                                  '+12%', 'up',   '✅'),
    statCard('Ожидает оплаты',   fmtMoneyK(totalDue),                                   '', '',          '⏳'),
    statCard('Просрочено',       state.invoices.filter(i => i.status==='overdue').length, 'требует внимания', 'down', '⚠️'),
  ]));

  wrap.append(el('div', { class:'mt-16 table-wrap' }, (() => {
    const tab = el('table', { class:'data' });
    tab.append(el('thead', {}, el('tr', {}, [
      el('th', {}, '№ счёта'),
      el('th', {}, 'Дата'),
      el('th', {}, 'Клиент'),
      el('th', {}, 'Сделка'),
      el('th', { class:'num' }, 'Сумма'),
      el('th', {}, 'Срок оплаты'),
      el('th', {}, 'Статус'),
    ])));
    tab.append(el('tbody', {}, state.invoices.map(iv => {
      const cl = clientById(iv.client);
      const dl = byId(state.deals, iv.deal);
      const stMap = {
        paid:    el('span', { class:'pill pill-success' }, '✓ Оплачено'),
        pending: el('span', { class:'pill pill-warn' }, '⏳ Ожидает'),
        overdue: el('span', { class:'pill pill-danger' }, '⚠ Просрочка'),
      };
      return el('tr', { onclick: () => openInvoiceDetail(iv.id) }, [
        el('td', { class:'strong' }, iv.no),
        el('td', {}, fmtDate(iv.date)),
        el('td', {}, cl.name),
        el('td', { class:'muted' }, dl ? '№' + dl.no : '—'),
        el('td', { class:'num strong' }, fmtMoneyK(iv.amount)),
        el('td', {}, fmtDate(iv.due)),
        el('td', {}, stMap[iv.status] || '—'),
      ]);
    })));
    return tab;
  })()));
  return wrap;
};

// ============================================================
// VIEW: LEADS
// ============================================================
VIEWS.leads = () => {
  const wrap = el('div');
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Входящие заявки'), el('div', { class:'sub' }, 'С сайта, телефона, WhatsApp — до конвертации в сделку')]),
    el('div', { class:'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewLead }, '+ Заявка')]),
  ]));
  const t = el('div', { class:'table-wrap' });
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Время'),
    el('th', {}, 'Источник'),
    el('th', {}, 'Контакт'),
    el('th', {}, 'Телефон'),
    el('th', {}, 'Тема'),
    el('th', {}, 'Статус'),
    el('th', {}, ''),
  ])));
  tab.append(el('tbody', {}, state.leads.map(l => el('tr', {}, [
    el('td', { class:'muted' }, l.created),
    el('td', {}, el('span', { class:'tag' }, l.source)),
    el('td', { class:'strong' }, l.name),
    el('td', {}, l.phone),
    el('td', {}, l.subject),
    el('td', {}, l.status === 'new' ? el('span', { class:'pill pill-info' }, 'Новая')
              : l.status === 'in-work' ? el('span', { class:'pill pill-warn' }, 'В работе')
              : el('span', { class:'pill pill-success' }, '→ Сделка')),
    el('td', { class:'num' }, l.status !== 'converted'
      ? el('button', { class:'btn btn-sm btn-primary', onclick: (ev) => { ev.stopPropagation(); convertLead(l.id); } }, 'В сделку →')
      : null),
  ]))));
  t.append(tab);
  wrap.append(t);
  return wrap;
};

// ============================================================
// VIEW: SUPPLIERS
// ============================================================
VIEWS.suppliers = () => {
  const wrap = el('div');
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Поставщики'), el('div', { class:'sub' }, `${state.suppliers.length} партнёров · главный — EKF (78%)`)]),
    el('div', { class:'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewSupplier }, '+ Поставщик')]),
  ]));
  const grid = el('div', { class:'grid grid-3' });
  state.suppliers.forEach(s => {
    grid.append(el('div', { class:'card', style:'cursor:pointer', onclick: () => openSupplierDetail(s.id) }, [
      el('div', { class:'row', style:'justify-content:space-between;margin-bottom:8px' }, [
        el('div', { class:'strong', style:'font-size:15px' }, s.name),
        el('span', { class:'pill pill-info' }, s.share + '% закупок'),
      ]),
      el('div', { class:'bar-mini' }, el('div', { style:`width:${s.share}%` })),
      el('dl', { class:'kv mt-12', style:'grid-template-columns:120px 1fr' }, [
        el('dt', {}, 'Контакт'),       el('dd', {}, s.contact),
        el('dt', {}, 'Телефон'),       el('dd', {}, s.phone),
        el('dt', {}, 'Email'),         el('dd', {}, s.email),
        el('dt', {}, 'Последняя поставка'), el('dd', {}, fmtDate(s.lastDelivery)),
      ]),
      el('div', { class:'muted mt-12', style:'font-size:12px;line-height:1.4' }, s.note),
    ]));
  });
  wrap.append(grid);
  return wrap;
};

// ============================================================
// VIEW: TASKS
// ============================================================
VIEWS.tasks = () => {
  const wrap = el('div');
  const open = state.tasks.filter(t => !t.done);
  const overdue = open.filter(t => taskDue(t).kind === 'overdue');
  const today = open.filter(t => taskDue(t).kind === 'today');
  const subParts = [`${open.length} открытых · ${state.tasks.filter(t => t.done).length} выполнено`];
  if (overdue.length) subParts.push(`⚠️ ${overdue.length} просрочено`);
  if (today.length) subParts.push(`🔔 ${today.length} на сегодня`);
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Задачи'), el('div', { class:'sub' }, subParts.join(' · '))]),
    el('div', { class:'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewTask }, '+ Задача')]),
  ]));
  const list = el('div', { class:'card' });
  // сортировка: просроченные → на сегодня → скоро → прочие → выполненные
  const ord = { overdue: 0, today: 1, soon: 2, future: 3, none: 4 };
  const sorted = state.tasks.slice().sort((a, b) => {
    const ka = a.done ? 9 : ord[taskDue(a).kind]; const kb = b.done ? 9 : ord[taskDue(b).kind];
    if (ka !== kb) return ka - kb;
    return String(a.due || '').localeCompare(String(b.due || ''));
  });
  sorted.forEach(t => {
    const u = userById(t.owner);
    const st = t.done ? { kind: 'done' } : taskDue(t);
    const remind = st.kind === 'overdue' ? el('span', { class:'pill pill-danger', style:'font-size:10px;margin-left:6px' }, '⚠️ просрочено')
      : st.kind === 'today' ? el('span', { class:'pill pill-warn', style:'font-size:10px;margin-left:6px' }, '🔔 сегодня')
      : st.kind === 'soon' ? el('span', { class:'pill', style:'font-size:10px;margin-left:6px;background:#EEF2FF;color:#4F46E5' }, 'скоро') : null;
    list.append(el('div', { class:'activity-item', style:'padding:10px 0;border-bottom:1px solid #F3F4F6' }, [
      el('input', { type:'checkbox', checked: t.done ? 'checked' : null, style:'margin-top:8px;width:18px;height:18px',
        onchange: async (e) => { t.done = e.target.checked; try { await window.__API__.apiFetch('tasks/' + t.id, { method: 'PUT', body: { done: t.done ? 1 : 0 } }); toast(t.done ? 'Задача выполнена' : 'Задача возвращена в работу', 'success'); } catch (err) { toast('Не удалось сохранить', 'error'); } navigate('tasks'); }
      }),
      el('div', { class:'flex-1' }, [
        el('div', { style: t.done ? 'text-decoration:line-through;color:#9CA3AF' : '' }, [t.title, remind]),
        el('div', { class:'av-time' }, [
          `${u.name} · до ${t.due} · `,
          el('span', { class:'pill ' + (t.priority==='high' ? 'pill-danger' : t.priority==='medium' ? 'pill-warn' : 'pill-muted') }, t.priority),
        ]),
      ]),
      el('span', { class:'avatar', style:`background:${u.color}` }, u.avatar),
    ]));
  });
  wrap.append(list);
  return wrap;
};

// ============================================================
// VIEW: REPORTS
// ============================================================
VIEWS.reports = () => {
  const wrap = el('div');
  const now = new Date();
  const monthName = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Отчёты'), el('div', { class:'sub' }, `${monthName} · по данным CRM (выигранные сделки: оплата/отгрузка/закрытие)`)]),
    el('div', { class:'actions' }, [el('button', { class:'btn', onclick: () => exportReportPDF() }, '📥 Экспорт PDF')]),
  ]));

  // helper: «YYYY-MM» -> «мес ГГ»
  const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const monLabel = (m) => { const [y, mm] = String(m).split('-'); return (MON[(+mm) - 1] || m) + ' ' + String(y).slice(2); };
  const noData = (text) => el('div', { class:'muted', style:'padding:28px;text-align:center' }, text);

  // Выручка по месяцам — line
  const card1 = el('div', { class:'card' });
  card1.append(el('div', { class:'card-head' }, el('h3', {}, 'Выручка по месяцам (млн ₸)')));
  const host1 = el('div', { style:'padding:8px 4px' }, noData('Загрузка…'));
  card1.append(host1);
  wrap.append(card1);

  const rowCharts = el('div', { class:'grid grid-2 mt-16' });
  const cardCat = el('div', { class:'card' });
  cardCat.append(el('div', { class:'card-head' }, el('h3', {}, 'Доля продаж по категориям')));
  const host2 = el('div', { style:'padding:8px 4px' }, noData('Загрузка…'));
  cardCat.append(host2);
  rowCharts.append(cardCat);

  const cardMgr = el('div', { class:'card' });
  cardMgr.append(el('div', { class:'card-head' }, el('h3', {}, 'Продажи по менеджерам (млн ₸)')));
  const host3 = el('div', { style:'padding:8px 4px' }, noData('Загрузка…'));
  cardMgr.append(host3);
  rowCharts.append(cardMgr);
  wrap.append(rowCharts);

  // По менеджерам (таблица) + ABC
  const row = el('div', { class:'grid grid-2 mt-16' });
  const mgrCard = el('div', { class:'card' });
  mgrCard.append(el('div', { class:'card-head' }, el('h3', {}, 'Менеджеры — продажи')));
  const mgrHost = el('div', {}, noData('Загрузка…'));
  mgrCard.append(mgrHost);
  row.append(mgrCard);

  // ABC клиентов — из данных CRM (LTV клиентов)
  const abc = el('div', { class:'card' });
  abc.append(el('div', { class:'card-head' }, el('h3', {}, 'ABC-анализ клиентов (по LTV)')));
  const sorted = [...state.clients].sort((a,b)=>b.ltv-a.ltv).filter(c => c.ltv > 0);
  const totalLtv = sorted.reduce((s,c)=>s+c.ltv,0);
  if (!sorted.length || totalLtv <= 0) {
    abc.append(noData('Нет данных по LTV клиентов'));
  } else {
    let cum = 0;
    const abcTab = el('table', { class:'data' });
    abcTab.append(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Клиент'), el('th', { class:'num' }, 'LTV'), el('th', { class:'num' }, 'Доля'), el('th', {}, 'ABC'),
    ])));
    abcTab.append(el('tbody', {}, sorted.slice(0,8).map(c => {
      cum += c.ltv;
      const share = c.ltv / totalLtv * 100;
      const cumShare = cum / totalLtv * 100;
      const grp = cumShare < 80 ? 'A' : cumShare < 95 ? 'B' : 'C';
      return el('tr', {}, [
        el('td', { class:'strong' }, c.name),
        el('td', { class:'num' }, fmtMoneyK(c.ltv)),
        el('td', { class:'num muted' }, share.toFixed(1) + '%'),
        el('td', {}, el('span', { class:'pill ' + (grp==='A'?'pill-success':grp==='B'?'pill-warn':'pill-muted') }, grp)),
      ]);
    })));
    abc.append(abcTab);
  }
  row.append(abc);
  wrap.append(row);

  // Загрузка реальных агрегатов и отрисовка
  window.__API__.apiFetch('reports/summary').then(rep => {
    const brand = '#00A6E2';
    const palette = ['#00A6E2','#7B61FF','#FF9F43','#28C76F','#EF4444','#06B6D4'];
    if (window.Chart) {
      Chart.defaults.font.family = "'Inter', sans-serif";
      Chart.defaults.font.size = 12;
      Chart.defaults.color = '#6B7280';
    }

    // 1) Выручка по месяцам
    const months = rep.byMonth || [];
    host1.innerHTML = '';
    if (!window.Chart || !months.length) {
      host1.append(noData(months.length ? 'График недоступен' : 'Нет выигранных сделок с датой'));
    } else {
      const cv1 = el('canvas', { style:'max-height:260px' }); host1.append(cv1);
      new Chart(cv1.getContext('2d'), {
        type: 'line',
        data: { labels: months.map(m => monLabel(m.month)), datasets: [{
          label: 'Выручка, млн ₸', data: months.map(m => Math.round(m.sum / 1e6 * 10) / 10),
          borderColor: brand, backgroundColor: brand + '22', tension: 0.35, fill: true, borderWidth: 3,
          pointBackgroundColor: brand, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 5,
        }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
      });
    }

    // 2) Доля продаж по категориям
    const cats = (rep.byCategory || []).slice(0, 6);
    host2.innerHTML = '';
    if (!window.Chart || !cats.length) {
      host2.append(noData('Нет продаж с позициями. Добавьте товары в сделки.'));
    } else {
      const cv2 = el('canvas', { style:'max-height:260px' }); host2.append(cv2);
      new Chart(cv2.getContext('2d'), {
        type: 'doughnut',
        data: { labels: cats.map(c => c.category), datasets: [{ data: cats.map(c => c.sum), backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtMoneyK(ctx.parsed) } } } },
      });
    }

    // 3) Продажи по менеджерам (bar) + таблица
    const mgr = (rep.byManager || [])
      .map(m => ({ ...m, user: byId(state.users, m.manager_id) }))
      .filter(m => m.sum > 0 || m.count > 0)
      .sort((a, b) => b.sum - a.sum);
    host3.innerHTML = '';
    if (!window.Chart || !mgr.length) {
      host3.append(noData('Нет выигранных сделок'));
    } else {
      const cv3 = el('canvas', { style:'max-height:260px' }); host3.append(cv3);
      new Chart(cv3.getContext('2d'), {
        type: 'bar',
        data: { labels: mgr.map(m => (m.user ? m.user.name.split(' ')[0] : '—')), datasets: [{ label: 'Факт', data: mgr.map(m => Math.round(m.sum / 1e6 * 10) / 10), backgroundColor: brand, borderRadius: 6 }] },
        options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' млн ₸' } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'млн ₸' } } } },
      });
    }

    // таблица менеджеров — доля от общего факта
    const totalFact = mgr.reduce((s, m) => s + m.sum, 0);
    mgrHost.innerHTML = '';
    if (!mgr.length) {
      mgrHost.append(noData('Нет выигранных сделок'));
    } else {
      const mt = el('table', { class:'data' });
      mt.append(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Менеджер'), el('th', { class:'num' }, 'Сделок'), el('th', { class:'num' }, 'Факт'), el('th', {}, 'Доля'),
      ])));
      mt.append(el('tbody', {}, mgr.map(m => {
        const u = m.user || { name: '—', avatar: '?', color: '#9CA3AF' };
        const pct = totalFact > 0 ? Math.round(m.sum / totalFact * 100) : 0;
        return el('tr', {}, [
          el('td', {}, el('div', { class:'row' }, [
            el('span', { class:'avatar', style:`width:24px;height:24px;font-size:10px;background:${u.color}` }, u.avatar),
            el('span', {}, u.name),
          ])),
          el('td', { class:'num' }, m.count),
          el('td', { class:'num strong' }, fmtMoneyK(m.sum)),
          el('td', {}, el('div', { class:'bar-mini', style:'min-width:120px' }, el('div', { style:`width:${Math.min(100,pct)}%; background:${brand}` }))),
        ]);
      })));
      mgrHost.append(mt);
    }
  }).catch(e => {
    [host1, host2, host3, mgrHost].forEach(h => { h.innerHTML = ''; h.append(noData('Ошибка загрузки аналитики')); });
  });

  return wrap;
};

// ============================================================
// VIEW: SETTINGS
// ============================================================
VIEWS.settings = () => {
  const wrap = el('div');
  const canEditUsers = can('edit-users');
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Настройки'), el('div', { class:'sub' }, canEditUsers ? 'Команда, права доступа, реквизиты' : 'Только просмотр — управление доступно директору')]),
  ]));

  // Пользователи + Управление командой
  const card = el('div', { class:'card' });
  card.append(el('div', { class:'card-head' }, [
    el('h3', {}, `Команда (${state.users.filter(u=>u.active).length} активных · ${state.users.filter(u=>!u.active).length} заблокировано)`),
    canEditUsers ? el('button', { class:'btn btn-sm btn-primary', onclick: openEditUser }, '+ Пользователь') : null,
  ]));
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, ''), el('th', {}, 'ФИО'), el('th', {}, 'Роль'), el('th', {}, 'Email'), el('th', {}, 'Телефон'), el('th', {}, 'Статус'), el('th', { class:'num' }, ''),
  ])));
  tab.append(el('tbody', {}, state.users.map(u => {
    const isMe = currentUser.id === u.id;
    return el('tr', { class: u.active === false ? 'muted' : '', style: u.active === false ? 'opacity:.55' : '' }, [
      el('td', {}, el('span', { class:'avatar', style:`background:${u.color}` }, u.avatar)),
      el('td', { class:'strong' }, [u.name, isMe ? el('span', { class:'pill pill-info', style:'margin-left:6px;font-size:10px' }, 'это вы') : null]),
      el('td', {}, el('span', { class:'pill', style:`background:${(ROLES[u.roleKey]||{}).color || '#999'}22;color:${(ROLES[u.roleKey]||{}).color || '#999'}` }, u.role)),
      el('td', {}, u.email),
      el('td', {}, u.phone),
      el('td', {}, u.active === false ? el('span', { class:'pill pill-danger' }, '🚫 Заблокирован') : el('span', { class:'pill pill-success' }, '✓ Активен')),
      el('td', { class:'num' }, canEditUsers ? el('div', { class:'row', style:'justify-content:flex-end;gap:4px' }, [
        el('button', { class:'btn btn-sm', onclick: () => openEditUser(u.id) }, '✏️'),
        !isMe && u.active !== false ? el('button', { class:'btn btn-sm', title:'Заблокировать', onclick: async () => { u.active = false; try { await window.__API__.apiFetch('users/' + u.id, { method: 'PUT', body: { active: 0 } }); toast(u.name + ' заблокирован', 'warn'); } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); } navigate('settings'); } }, '🚫') : null,
        !isMe && u.active === false ? el('button', { class:'btn btn-sm', title:'Активировать', onclick: async () => { u.active = true; try { await window.__API__.apiFetch('users/' + u.id, { method: 'PUT', body: { active: 1 } }); toast(u.name + ' активирован', 'success'); } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); } navigate('settings'); } }, '✓') : null,
        !isMe ? el('button', { class:'btn btn-sm', title:'Удалить', onclick: async () => { if (confirm('Удалить ' + u.name + '?')) { try { await window.__API__.apiFetch('users/' + u.id, { method: 'DELETE' }); state.users = state.users.filter(x => x.id !== u.id); toast('Пользователь удалён', 'success'); } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); } navigate('settings'); } } }, '🗑') : null,
      ]) : el('span', { class:'muted' }, '—')),
    ]);
  })));
  card.append(tab);
  wrap.append(card);

  // Синхронизация с 1С (только директор)
  if (can('edit-users')) {
    const syncCard = el('div', { class:'card mt-16' });
    syncCard.append(el('div', { class:'card-head' }, el('h3', {}, 'Синхронизация с 1С')));
    const statusHost = el('div', { class:'muted', style:'font-size:12px;margin-bottom:12px' }, 'Статус: загрузка…');
    const syncBtn = (label, path, confirmMsg) => el('button', { class:'btn btn-primary', onclick: async (e) => {
      const b = e.currentTarget;
      if (!confirm(confirmMsg)) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'Синхронизация…';
      toast('Синхронизация с 1С…', 'info');
      try {
        const r = await window.__API__.apiFetch(path, { method: 'POST' });
        toast(`1С: получено ${r.fetched}, новых ${r.created}, обновлено ${r.updated}`, 'success');
        await loadData(); navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = old; }
    } }, label);
    const productsFullBtn = el('button', { class:'btn btn-primary', onclick: async (e) => {
      const b = e.currentTarget;
      if (!confirm('Полный импорт всех товаров (без услуг) из 1С? Может занять несколько минут.')) return;
      b.disabled = true; const old = b.textContent;
      let skip = 0, created = 0, updated = 0, fetched = 0, page = 0;
      try {
        b.textContent = 'Категории…';
        await window.__API__.apiFetch('sync/1c/categories', { method: 'POST' });
        while (true) {
          page++;
          b.textContent = `Импорт… ${fetched}`;
          const r = await window.__API__.apiFetch(`sync/1c/products?limit=1000&skip=${skip}`, { method: 'POST' });
          created += r.created; updated += r.updated; fetched += r.fetched; skip = r.next;
          if (r.done || r.fetched === 0 || page > 80) break;
        }
        toast(`Номенклатура: получено ${fetched}, новых ${created}, обновлено ${updated}`, 'success');
        await loadData(); navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = old; }
    } }, '🔄 Номенклатура → Товары (всё)');
    const stockBtn = el('button', { class:'btn btn-primary', onclick: async (e) => {
      const b = e.currentTarget;
      if (!confirm('Загрузить остатки из 1С на склад?')) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'Остатки…';
      try {
        const r = await window.__API__.apiFetch('sync/1c/stock', { method: 'POST' });
        toast(`Остатки: обновлено ${r.updated}${r.missing ? ', без сопоставления ' + r.missing : ''}`, 'success');
        await loadData(); navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = old; }
    } }, '🔄 Остатки → Склад');
    const pricesBtn = (mode, label) => el('button', { class:'btn btn-primary', onclick: async (e) => {
      const b = e.currentTarget;
      const m = mode === 'avg' ? 'средней цены' : 'последней цены';
      if (!confirm(`Пересчитать закупочную цену по ${m} из приходов 1С? Может занять до минуты.`)) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'Цены…';
      try {
        const r = await window.__API__.apiFetch(`sync/1c/prices?mode=${mode}`, { method: 'POST' });
        toast(`Цены: обновлено ${r.updated} из ${r.priced}${r.missing ? ', без сопоставления ' + r.missing : ''}`, 'success');
        await loadData(); navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = old; }
    } }, label);
    const receiptsBtn = el('button', { class:'btn btn-primary', onclick: async (e) => {
      const b = e.currentTarget;
      if (!confirm('Загрузить последние приходы из 1С? Импортируются свежие документы поступления.')) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'Приходы…';
      try {
        const r = await window.__API__.apiFetch('sync/1c/receipts', { method: 'POST' });
        toast(`Приходы: импортировано ${r.imported}`, 'success');
        await loadData(); navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = old; }
    } }, '🔄 Приходы → Склад');
    syncCard.append(statusHost, el('div', { class:'row', style:'flex-wrap:wrap;gap:8px' }, [
      syncBtn('🔄 Контрагенты → Клиенты', 'sync/1c/clients', 'Загрузить контрагентов из 1С в «Клиенты»? Может занять до минуты.'),
      productsFullBtn,
      stockBtn,
      pricesBtn('last', '🔄 Цены из приходов → Закуп'),
      pricesBtn('avg', '🔄 Закуп (средняя)'),
      receiptsBtn,
    ]));
    wrap.append(syncCard);
    window.__API__.apiFetch('sync/status').then(rows => {
      rows = rows || [];
      const f = (e) => rows.find(x => x.entity === e);
      const cl = f('clients_1c'), pr = f('products_1c'), st = f('stock_1c'), px = f('prices_1c'), rc = f('receipts_1c');
      statusHost.innerHTML = '';
      statusHost.append(
        el('div', {}, cl ? `Контрагенты: ${String(cl.last_at).slice(0, 16)} · ${cl.info}` : 'Контрагенты ещё не синхронизировались'),
        el('div', {}, pr ? `Номенклатура: ${String(pr.last_at).slice(0, 16)} · ${pr.info}` : 'Номенклатура ещё не синхронизировалась'),
        el('div', {}, st ? `Остатки: ${String(st.last_at).slice(0, 16)} · ${st.info}` : 'Остатки ещё не синхронизировались'),
        el('div', {}, px ? `Цены: ${String(px.last_at).slice(0, 16)} · ${px.info}` : 'Цены ещё не пересчитывались'),
        el('div', {}, rc ? `Приходы: ${String(rc.last_at).slice(0, 16)} · ${rc.info}` : 'Приходы ещё не синхронизировались'),
      );
    }).catch(() => { statusHost.textContent = ''; });
  }

  // Матрица прав
  const permsCard = el('div', { class:'card mt-16' });
  permsCard.append(el('div', { class:'card-head' }, el('h3', {}, 'Матрица доступа по ролям')));
  const pt = el('table', { class:'data' });
  pt.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Модуль'),
    el('th', { class:'num' }, '👔 Директор'),
    el('th', { class:'num' }, '💼 Менеджер'),
    el('th', { class:'num' }, '🏭 Кладовщик'),
    el('th', { class:'num' }, '💰 Бухгалтер'),
  ])));
  const ALL_MODULES = [
    ['dashboard','Дашборд'],['leads','Заявки'],['deals','Сделки'],['clients','Клиенты'],
    ['catalog','Каталог'],['warehouse','Склад'],['shipments','Отгрузки'],['invoices','Документы'],
    ['suppliers','Поставщики'],['tasks','Задачи'],['reports','Отчёты'],['settings','Настройки'],
  ];
  pt.append(el('tbody', {}, ALL_MODULES.map(([k,label]) => el('tr', {}, [
    el('td', { class:'strong' }, label),
    ...['director','manager','warehouse','accountant'].map(rk => {
      const has = ROLES[rk].modules.includes(k);
      return el('td', { class:'num' }, has ? el('span', { style:'color:#10B981;font-size:16px' }, '✓') : el('span', { style:'color:#9CA3AF' }, '—'));
    }),
  ]))));
  permsCard.append(pt);
  wrap.append(permsCard);

  // Прочее
  const info = el('div', { class:'card mt-16' });
  info.append(el('div', { class:'card-head' }, el('h3', {}, 'О компании')));
  info.append(el('dl', { class:'kv' }, [
    el('dt', {}, 'Юридическое наименование'), el('dd', {}, 'ТОО «KazEnergoSnab»'),
    el('dt', {}, 'БИН'),                       el('dd', {}, '180440099887'),
    el('dt', {}, 'Адрес'),                     el('dd', {}, 'Караганда, ул. Бытовая, 13/1'),
    el('dt', {}, 'Время работы'),              el('dd', {}, 'Пн–Пт 9:00–18:00, обед 13:00–14:00'),
    el('dt', {}, 'Сайт'),                      el('dd', {}, 'snabenergo.kz'),
    el('dt', {}, 'Статус EKF'),                el('dd', {}, 'Сертифицированный субдилер по РК с 2018'),
  ]));
  wrap.append(info);

  // Сброс
  const reset = el('div', { class:'card mt-16' });
  reset.append(el('div', { class:'card-head' }, el('h3', {}, 'Демо-данные')));
  reset.append(el('div', {}, [
    el('p', { class:'muted', style:'margin-top:0' }, 'Этот мокап хранит данные в localStorage. Все изменения (создание сделок, отметки задач) сохраняются между перезагрузками.'),
    el('button', { class:'btn btn-danger', onclick: () => { if (confirm('Сбросить все демо-данные?')) resetState(); } }, '↺ Сбросить к исходным'),
  ]));
  wrap.append(reset);
  return wrap;
};

// ============================================================
// Init
// ============================================================
// ============================================================
// AUTH — логин-экран, сессии, выход
// ============================================================
function renderLogin(errMsg = null) {
  document.body.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <svg width="44" height="50" viewBox="0 0 100 110" aria-hidden="true">
            <polygon points="50,5 90,28 90,82 50,105 10,82 10,28" fill="none" stroke="#00A6E2" stroke-width="6"/>
            <text x="50" y="62" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="32" fill="#111">KES</text>
            <text x="50" y="80" text-anchor="middle" font-family="Inter, Arial" font-size="9" fill="#111" opacity=".85">KazEnergoSnab</text>
          </svg>
          <div class="logo-text">
            <b>KES CRM</b>
            <span>ТОО KazEnergoSnab · Караганда</span>
          </div>
        </div>
        <h2>Войдите как один из сотрудников</h2>
        <p class="login-sub">Это демо — нажмите на любую плитку, чтобы войти. Каждая роль видит свой набор разделов.</p>

        <div class="demo-accounts big" id="demoAccs"></div>

        <details class="manual-login">
          <summary>Войти вручную (email + пароль)</summary>
          <form class="login-form" id="loginForm" style="margin-top:14px">
            <div>
              <label>Email</label>
              <input type="email" id="loginEmail" placeholder="pavel@snabenergo.kz" autocomplete="email" required>
            </div>
            <div>
              <label>Пароль <span style="color:#00A6E2;font-weight:600">(для всех демо-аккаунтов: <code>demo</code>)</span></label>
              <input type="password" id="loginPass" placeholder="demo" value="demo" autocomplete="current-password" required>
            </div>
            <div class="login-err" id="loginErr">${errMsg || ''}</div>
            <button type="submit" class="btn btn-primary">Войти</button>
          </form>
        </details>

        <div class="login-foot">© 2026 KES CRM · Все данные демо · Сброс в сайдбаре после входа</div>
      </div>
    </div>
  `;

  // 4 демо-кнопки (по одной на роль) — большие, заметные.
  // Если в state.users нет roleKey (старый сохранённый state) — берём из SEED.
  const accBox = document.getElementById('demoAccs');
  const sourceUsers = state.users.some(u => u.roleKey) ? state.users : window.__KES__.SEED.users;
  const demoRoles = [
    { rk: 'director',  hint: 'видит всё, может всё' },
    { rk: 'manager',   hint: 'только свои сделки и клиенты' },
    { rk: 'warehouse', hint: 'склад, отгрузки, каталог' },
    { rk: 'accountant', hint: 'документы, счета, контрагенты' },
  ];
  demoRoles.forEach(({ rk, hint }) => {
    const u = sourceUsers.find(x => x.roleKey === rk);
    if (!u) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-acc big';
    btn.innerHTML = `
      <span class="avatar" style="background:${u.color}">${u.avatar}</span>
      <div class="demo-body">
        <div class="demo-name">${u.name}</div>
        <div class="demo-role">${u.role}</div>
        <div class="demo-hint">${hint}</div>
      </div>
      <span class="demo-arrow">→</span>
    `;
    btn.onclick = () => doLogin(u.email, 'demo');
    accBox.appendChild(btn);
  });

  // Показать ошибку, если есть — открыть форму
  if (errMsg) {
    document.querySelector('.manual-login').open = true;
    document.getElementById('loginErr').classList.add('show');
  }

  document.getElementById('loginForm').onsubmit = (e) => {
    e.preventDefault();
    doLogin(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPass').value);
  };
}

async function doLogin(email, password) {
  try {
    await window.__API__.login(email, password);
    await loadData();
    renderShell();
  } catch (e) {
    renderLogin(e && e.status === 401 ? 'Неверный email или пароль' : ('Ошибка входа: ' + ((e && e.message) || e)));
  }
}

function logout() {
  window.__API__.logout();
  location.reload();
}

// ============================================================
// PERMISSIONS — что видит и может текущий пользователь
// ============================================================
function role() { return ROLES[currentUser?.roleKey] || ROLES.manager; }
function can(action, target) {
  const r = role();
  if (action === 'see-module')  return r.modules.includes(target);
  if (action === 'edit-deal')   return r.canEdit.deals === 'all' || (r.canEdit.deals === 'own' && target?.manager === currentUser.id);
  if (action === 'edit-client') return r.canEdit.clients === 'all' || (r.canEdit.clients === 'own' && target?.manager === currentUser.id);
  if (action === 'edit-product') return r.canEdit.products === true;
  if (action === 'edit-stock')   return r.canEdit.products === true || r.canEdit.products === 'stock';
  if (action === 'edit-users')   return r.canEdit.users === true;
  if (action === 'edit-prices')  return r.canEdit.prices === true;
  if (action === 'edit-invoice') return r.canEdit.invoices === true;
  return false;
}
// Фильтр данных по принадлежности (для менеджера — только своё)
function visibleDeals()    { return role().seeAllData ? state.deals    : state.deals.filter(d => d.manager === currentUser.id); }
function visibleClients()  { return role().seeAllData ? state.clients  : state.clients.filter(c => c.manager === currentUser.id); }
function visibleTasks()    { return role().seeAllData ? state.tasks    : state.tasks.filter(t => t.owner === currentUser.id); }

// ============================================================
// BOOT — после успешного логина
// ============================================================
// Загрузка данных из боевого API в state + справочники из БД
async function loadData() {
  const { state: s, dict } = await window.__API__.loadAllData();
  state = s;
  STAGES = dict.STAGES;
  ROLES = dict.ROLES;
  CLIENT_TYPES = dict.CLIENT_TYPES;
  currentUser = state.users.find(u => u.id === jwtSub(window.__API__.getToken())) || null;
}

// Достаём sub (id пользователя) из JWT без проверки подписи — только для UI
function jwtSub(token) {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b)))).sub;
  } catch (e) { return null; }
}

async function bootApp() {
  if (!window.__API__ || !window.__API__.isAuthed()) { renderLogin(); return; }
  try {
    await loadData();
    if (!currentUser || currentUser.active === false) {
      window.__API__.logout();
      renderLogin('Сессия истекла — войдите снова');
      return;
    }
    renderShell();
  } catch (e) {
    window.__API__.logout();
    renderLogin('Не удалось загрузить данные. Войдите снова.');
  }
}

function renderShell() {
  const r = role();
  document.body.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <svg class="logo-mark" width="34" height="38" viewBox="0 0 100 110" aria-hidden="true">
            <polygon points="50,5 90,28 90,82 50,105 10,82 10,28" fill="none" stroke="#00A6E2" stroke-width="6"/>
            <text x="50" y="62" text-anchor="middle" font-family="Inter, Arial" font-weight="900" font-size="32" fill="#fff">KES</text>
            <text x="50" y="80" text-anchor="middle" font-family="Inter, Arial" font-size="9" fill="#fff" opacity=".85">KazEnergoSnab</text>
          </svg>
          <div class="logo-text">
            <b>KES CRM</b>
            <span>v0.2</span>
          </div>
        </div>
        <div class="sidebar-tenant">KazEnergoSnab • Караганда</div>
        <nav class="sidebar-nav" id="nav"></nav>
        <div class="sidebar-foot">
          <span>© 2026 KES</span>
          <button id="reset-state" title="Сбросить демо-данные">Сброс</button>
        </div>
      </aside>
      <header class="header">
        <button class="menu-toggle" id="menuToggle" aria-label="Меню">☰</button>
        <div class="header-title">
          <span class="crumb">CRM /</span>
          <span id="page-title">Дашборд</span>
        </div>
        <div class="header-search">
          <input id="search" type="search" placeholder="Поиск по клиентам, сделкам, SKU…" />
        </div>
        <div class="header-actions">
          <button class="icon-btn" title="Уведомления" id="notif-btn">🔔<span class="dot"></span></button>
          <button class="icon-btn" title="Помощь">?</button>
          <div class="user-chip">
            <div class="avatar" style="background:${currentUser.color}">${currentUser.avatar}</div>
            <div>
              <div class="name">${currentUser.name}</div>
              <div class="role">${currentUser.role}</div>
            </div>
            <button class="btn btn-ghost btn-sm" id="logoutBtn" style="margin-left:8px" title="Выйти">↩</button>
          </div>
        </div>
      </header>
      <main class="main" id="main">
        <div class="empty"><div class="em-icon">⏳</div><div class="em-text">Загрузка…</div></div>
      </main>
    </div>
    <div class="nav-backdrop" id="navBackdrop"></div>
    <div class="toast-stack" id="toasts"></div>
    <div id="dropdown-root"></div>
    <div class="modal-overlay" id="modal">
      <div class="modal">
        <div class="modal-head"><h3 id="modal-title">—</h3><button id="modal-close" aria-label="Закрыть">×</button></div>
        <div class="modal-body" id="modal-body"></div>
        <div class="modal-foot" id="modal-foot"></div>
      </div>
    </div>
  `;

  // Сайдбар — только разрешённые модули
  const NAV_ITEMS = [
    { v: 'dashboard',  icon: '📊', label: 'Дашборд' },
    { v: 'leads',      icon: '📥', label: 'Заявки',     badge: state.leads.filter(l => l.status === 'new').length },
    { v: 'deals',      icon: '💼', label: 'Сделки',     badge: visibleDeals().length },
    { v: 'clients',    icon: '👥', label: 'Клиенты',    badge: visibleClients().length },
    { v: 'catalog',    icon: '📦', label: 'Каталог',    badge: state.products.length },
    { v: 'warehouse',  icon: '🏭', label: 'Склад' },
    { v: 'shipments',  icon: '🚚', label: 'Отгрузки' },
    { v: 'invoices',   icon: '📄', label: 'Документы' },
    { v: 'suppliers',  icon: '🤝', label: 'Поставщики' },
    { v: 'tasks',      icon: '✅', label: 'Задачи',     badge: visibleTasks().filter(t => !t.done).length },
    { v: 'reports',    icon: '📈', label: 'Отчёты' },
    { v: 'settings',   icon: '⚙️', label: 'Настройки' },
  ];
  const nav = $('#nav');
  NAV_ITEMS.filter(it => r.modules.includes(it.v)).forEach((it, idx) => {
    const btn = el('button', { 'data-view': it.v, class: idx === 0 ? 'active' : '' }, [
      el('span', { class: 'icon' }, it.icon),
      ' ' + it.label + ' ',
      it.badge ? el('span', { class: 'badge' }, String(it.badge)) : null,
    ]);
    nav.appendChild(btn);
  });

  // Обработчики
  $('#reset-state').addEventListener('click', () => {
    if (confirm('Сбросить демо-данные? Это вернёт всех пользователей, сделки, клиентов к исходному состоянию.')) resetState();
  });
  $('#search').addEventListener('keyup', (e) => { if (e.key === 'Enter') runSearch(e.target.value); });
  $('#notif-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleNotifications(); });
  $$('.icon-btn').forEach(b => {
    if (b.id === 'notif-btn') return;
    if (b.title === 'Помощь' || b.textContent.trim() === '?') b.addEventListener('click', openAbout);
  });
  $('#logoutBtn').addEventListener('click', (e) => { e.stopPropagation(); logout(); });
  $('#menuToggle') && $('#menuToggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#navBackdrop') && $('#navBackdrop').addEventListener('click', () => document.body.classList.remove('nav-open'));

  // Первая страница — первая доступная роли
  const firstView = r.modules[0] || 'dashboard';
  navigate(firstView);

  // Напоминания по задачам: индикатор на колокольчике + тост о просроченных
  const dot = $('#notif-btn .dot');
  if (dot) dot.style.display = taskReminders().length ? '' : 'none';
  const overdueCount = visibleTasks().filter(t => !t.done && taskDue(t).kind === 'overdue').length;
  if (overdueCount) setTimeout(() => toast(`У вас ${overdueCount} ${plural(overdueCount, 'просроченная задача', 'просроченные задачи', 'просроченных задач')}`, 'warn'), 700);
}

// ============================================================
// Init
// ============================================================
bootApp();
