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
  if (navBtn) { navigate(navBtn.dataset.view); return; }
  const navLink = e.target.closest('[data-nav]');
  if (navLink) {
    e.preventDefault();
    navigate(navLink.dataset.nav, JSON.parse(navLink.dataset.params || '{}'));
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!name.get().trim()) { toast('Введите наименование', 'warn'); return; }
        state.clients.unshift({
          id: 'cl' + Date.now(), name: name.get().trim(), bin: bin.get(), type: type.get(),
          contact: contact.get(), phone: phone.get(), email: email.get() || '—',
          city: city.get(), address: address.get(), manager: manager.get(),
          balance: 0, ltv: 0, lastDeal: new Date().toISOString().slice(0,10), tags: ['новый'],
        });
        saveState(state); closeModal(); toast('Клиент добавлен', 'success'); navigate('clients');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!name.get().trim()) { toast('Введите имя', 'warn'); return; }
        const now = new Date();
        const ts = now.toISOString().slice(0,10) + ' ' + now.toTimeString().slice(0,5);
        state.leads.unshift({
          id: 'l' + Date.now(), source: src.get(), name: name.get().trim(),
          phone: phone.get(), subject: sub.get(), created: ts, status: 'new',
        });
        saveState(state); closeModal(); toast('Заявка зарегистрирована', 'success'); navigate('leads');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        const today = new Date().toISOString().slice(0,10);
        const num = state.deals.length + 160;
        state.deals.unshift({
          id: 'd' + Date.now(), no: '2026-0' + num,
          client: client.get() || state.clients[0].id, manager: mgr.get(),
          stage: 'new', amount: Number(amount.get()) || 0, items: 0,
          created: today, target: today, title: name.get().trim() || l.subject,
        });
        l.status = 'converted';
        saveState(state); closeModal(); toast('Заявка → Сделка создана', 'success'); navigate('deals');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!title.get().trim()) { toast('Введите задачу', 'warn'); return; }
        state.tasks.unshift({
          id: 't' + Date.now(), title: title.get().trim(),
          due: due.get(), owner: owner.get(), deal: null, done: false, priority: prio.get(),
        });
        saveState(state); closeModal(); toast('Задача добавлена', 'success'); navigate('tasks');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!sku.get() || !name.get()) { toast('Заполните артикул и название', 'warn'); return; }
        state.products.unshift({
          id: 'p' + Date.now(), sku: sku.get(), name: name.get(), cat: cat.get(), brand: brand.get(),
          unit: unit.get(), priceCost: +pc.get()||0, priceWholesale: +pw.get()||0, priceRetail: +pr.get()||0,
          stock: +st.get()||0, reserved: 0,
        });
        saveState(state); closeModal(); toast('Товар добавлен в каталог', 'success'); navigate('catalog');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!name.get().trim()) { toast('Введите название', 'warn'); return; }
        state.suppliers.push({
          id: 'sp' + Date.now(), name: name.get().trim(), contact: contact.get(),
          phone: phone.get(), email: email.get(), share: 0,
          lastDelivery: new Date().toISOString().slice(0,10), note: note.get(),
        });
        saveState(state); closeModal(); toast('Поставщик добавлен', 'success'); navigate('suppliers');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        const d = byId(state.deals, deal.get());
        state.shipments.unshift({
          id: 'sh' + Date.now(), no: 'ТТН-0' + (515 + state.shipments.length),
          deal: deal.get(), client: d?.client || state.clients[0].id,
          date: date.get(), items: d?.items || 1, weight: 0,
          transport: transport.get(), driver: driver.get(),
          status: 'planned', destination: dest.get(),
        });
        saveState(state); closeModal(); toast('Отгрузка запланирована', 'success'); navigate('shipments');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        const d = byId(state.deals, deal.get());
        state.invoices.unshift({
          id: 'iv' + Date.now(), no: 'СФ-2026-0' + (240 + state.invoices.length),
          deal: deal.get(), client: d?.client, date: new Date().toISOString().slice(0,10),
          amount: +amount.get() || 0, status: 'pending', due: due.get(),
        });
        saveState(state); closeModal(); toast('Счёт выставлен', 'success'); navigate('invoices');
      } }, 'Выставить'),
    ],
  });
}

// ============================================================
// DETAIL MODALS — продукт / отгрузка / счёт / поставщик / уведомления
// ============================================================
function openProductDetail(id) {
  const p = byId(state.products, id);
  if (!p) return;
  const cat = categoryById(p.cat);
  const free = p.stock - p.reserved;
  const margin = Math.round((p.priceRetail - p.priceCost) / p.priceCost * 100);
  openModal({
    title: p.name,
    body: el('div', {}, [
      el('div', { class:'row', style:'gap:10px;margin-bottom:14px' }, [
        el('span', { class:'tag' }, p.sku),
        el('span', { class:'tag' }, cat.icon + ' ' + cat.name),
        el('span', { class:'tag' }, p.brand),
      ]),
      el('div', { class:'grid grid-3', style:'gap:10px;margin-bottom:14px' }, [
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Закуп'), el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, fmtMoney(p.priceCost))]),
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Опт'),   el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, fmtMoney(p.priceWholesale))]),
        el('div', { class:'card', style:'padding:12px' }, [el('div',{class:'stat-label'},'Розница'), el('div',{style:'font-size:18px;font-weight:600;margin-top:4px'}, fmtMoney(p.priceRetail))]),
      ]),
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Единица'),       el('dd', {}, p.unit),
        el('dt', {}, 'Остаток'),       el('dd', {}, `${p.stock} ${p.unit}`),
        el('dt', {}, 'Зарезервировано'), el('dd', {}, `${p.reserved} ${p.unit}`),
        el('dt', {}, 'Доступно'),      el('dd', {}, stockIndicator(free, p.stock)),
        el('dt', {}, 'Маржа розница'), el('dd', {}, margin + '%'),
      ]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: () => stub('Редактирование товара', 'Здесь будет форма редактирования цен, остатков и описания.', ['Загрузка фото','Привязка к нескольким поставщикам','История изменений цен']) }, '✏️ Изменить'),
      el('button', { class:'btn btn-primary', onclick: () => { closeModal(); toast(`+1 шт «${p.sku}» в новую сделку`, 'success'); } }, '+ В сделку'),
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
      el('button', { class:'btn', onclick: () => stub('Печать ТТН', 'PDF товарно-транспортной накладной с печатью KazEnergoSnab.') }, '🖨 Печать ТТН'),
      el('button', { class:'btn btn-primary', onclick: () => { s.status = 'delivered'; saveState(state); closeModal(); toast('Отгрузка отмечена доставленной', 'success'); navigate('shipments'); } }, '✓ Доставлено'),
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
        ? el('button', { class:'btn btn-primary', onclick: () => { iv.status = 'paid'; saveState(state); closeModal(); toast('Оплата зарегистрирована', 'success'); navigate('invoices'); } }, '✓ Оплачено')
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

// ---------- Notification dropdown ----------
function toggleNotifications() {
  const root = $('#dropdown-root');
  if (root.firstChild) { root.innerHTML = ''; return; }
  const backdrop = el('div', { class: 'backdrop-click', onclick: () => root.innerHTML = '' });
  const panel = el('div', { class: 'dropdown' }, [
    el('div', { class: 'dropdown-head' }, [
      el('h4', {}, 'Уведомления'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { root.innerHTML = ''; toast('Все уведомления отмечены прочитанными'); } }, 'Прочитать все'),
    ]),
    el('div', { class: 'dropdown-body' }, state.notifications.map(n => {
      const ic = { error: '⚠️', warn: '🟡', info: 'ℹ️' }[n.type] || 'ℹ️';
      return el('div', { class: 'dropdown-item', onclick: () => { root.innerHTML = ''; toast(n.text); } }, [
        el('span', { class: 'di-icon' }, ic),
        el('div', { class: 'di-body' }, [
          el('div', {}, n.text),
          el('div', { class: 'di-time' }, n.time),
        ]),
      ]);
    })),
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
  const password = fInput('Пароль', u?.password || 'demo');
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
      el('button', { class:'btn btn-primary', onclick: () => {
        if (!name.get().trim() || !email.get().trim()) { toast('Заполните имя и email', 'warn'); return; }
        const rk = roleSel.get();
        const initials = name.get().trim().split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
        if (isNew) {
          state.users.push({
            id: 'u' + Date.now(), name: name.get().trim(), email: email.get().trim(), phone: phone.get(),
            role: ROLES[rk].label, roleKey: rk, password: password.get() || 'demo',
            avatar: initials, color: colorSel.get(), active: true,
          });
          toast('Пользователь добавлен', 'success');
        } else {
          u.name = name.get().trim(); u.email = email.get().trim(); u.phone = phone.get();
          u.role = ROLES[rk].label; u.roleKey = rk;
          u.password = password.get() || u.password;
          u.color = colorSel.get(); u.avatar = initials;
          toast('Изменения сохранены', 'success');
        }
        saveState(state); closeModal(); navigate('settings');
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
      el('button', { class: 'btn', onclick: () => stub('Экспорт сводки', 'Сформирует PDF-сводку по продажам, пайплайну и дебиторке за выбранный период для отправки руководству.') }, '📥 Экспорт'),
      el('button', { class: 'btn btn-primary', onclick: () => openNewDeal() }, '+ Новая сделка'),
    ]),
  ]));

  // 4 KPI карточки
  const stats = el('div', { class: 'grid grid-4' });
  stats.append(statCard('Выручка месяц', fmtMoneyK(totalRevenue), '+12.4%', 'up',   '💰'));
  stats.append(statCard('Пайплайн',      fmtMoneyK(pipelineValue), '+8.1%',  'up',   '📈'));
  stats.append(statCard('Дебиторка',     fmtMoneyK(debtTotal),     overdueCount + ' просрочка', 'down', '⚠️'));
  stats.append(statCard('Новые заявки',  newLeads,                  'сегодня', 'up',  '📥'));
  wrap.append(stats);

  // 2 колонки: воронка + активность
  const row = el('div', { class: 'grid grid-2 mt-16' });

  // Воронка по этапам
  const funnelCard = el('div', { class: 'card' });
  funnelCard.append(el('div', { class: 'card-head' }, [
    el('h3', {}, 'Воронка продаж — май'),
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
  const lowStock = state.products
    .map(p => ({ ...p, free: p.stock - p.reserved }))
    .sort((a,b) => a.free - b.free)
    .slice(0, 5);
  const t = el('table', { class: 'data' });
  t.append(el('tbody', {}, lowStock.map(p => el('tr', {}, [
    el('td', {}, [
      el('div', { class: 'strong' }, p.name),
      el('div', { class: 'muted' }, p.sku + ' · ' + p.brand),
    ]),
    el('td', { class: 'num' }, stockIndicator(p.free, p.stock)),
  ]))));
  stockCard.append(el('div', { style:'overflow:hidden' }, t));
  row2.append(stockCard);

  // Последние сделки
  const recentCard = el('div', { class: 'card' });
  recentCard.append(el('div', { class: 'card-head' }, [el('h3', {}, 'Последние сделки'), el('a', { class:'more','data-nav':'deals' }, 'Все →')]));
  const rt = el('table', { class: 'data' });
  rt.append(el('tbody', {}, myDeals.slice(0, 6).map(d => {
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
    el('div', { class: 'stat-delta ' + dir }, (dir==='up'?'▲ ':'▼ ') + delta),
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
VIEWS.deals = () => {
  const wrap = el('div');
  const myDeals = visibleDeals();
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Сделки'),
      el('div', { class: 'sub' }, `${myDeals.length} ${role().seeAllData ? 'активных' : 'ваших активных'} · общая сумма ${fmtMoneyK(myDeals.reduce((s,d)=>s+d.amount,0))} · 💡 перетаскивайте карточки между этапами`),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => toast('Переключение список/Kanban — добавлю отдельный list-view', 'info') }, '📋 Список'),
      el('button', { class: 'btn btn-primary', onclick: () => openNewDeal() }, '+ Сделка'),
    ]),
  ]));

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
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!dragged) return;
      const deal = byId(state.deals, dragged.id);
      if (!deal) return;
      if (deal.stage === s.id) return;
      const fromLabel = stageById(deal.stage).label;
      deal.stage = s.id;
      saveState(state);
      toast(`${deal.title.slice(0,30)}: ${fromLabel} → ${s.label}`, 'success');
      navigate('deals');
    });

    kanban.append(col);
  });
  wrap.append(kanban);
  return wrap;
};

function openDealDetail(id) {
  const d = byId(state.deals, id);
  if (!d) return;
  if (!d.lineItems) d.lineItems = [];
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
      canEdit ? el('button', { class: 'btn btn-primary', onclick: () => {
        d.stage = stageSelect.value;
        saveState(state); closeModal(); toast('Сделка сохранена', 'success'); navigate('deals');
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
      el('button', { class: 'btn btn-primary', onclick: () => {
        if (!titleI.value.trim()) { titleI.focus(); return; }
        const today = new Date().toISOString().slice(0,10);
        const num = state.deals.length + 160;
        state.deals.unshift({
          id: 'd' + Date.now(),
          no: '2026-0' + num,
          client: clientSel.value,
          manager: mgrSel.value,
          stage: 'new',
          amount: Number(amountI.value) || 0,
          items: 0,
          created: today,
          target: today,
          title: titleI.value.trim(),
        });
        saveState(state);
        closeModal();
        navigate('deals');
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
      el('button', { class: 'btn', onclick: () => stub('Импорт клиентов', 'Поддержка XLSX/CSV. Сопоставление колонок (БИН, наименование, контакт, телефон) и дедупликация по БИН.', ['Шаблон под выгрузку из 1С','Превью с подсветкой ошибок','Опция «обновить существующих по БИН»']) }, '📥 Импорт'),
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
    el('button', { class: 'btn btn-sm', onclick: () => toast(`Экспортировано ${state.clients.length} клиентов в CSV (мок)`, 'success') }, 'Экспорт CSV'),
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
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Каталог номенклатуры'),
      el('div', { class: 'sub' }, `${state.categories.length} категорий · ${state.products.length} SKU в демо (~1100 в проде)`),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => stub('Импорт прайса EKF', 'Загрузка официального XLSX EKF — автоматически обновит закупочные цены и подтянет новые SKU.', ['Сверка по артикулу EKF','Подсветка изменившихся цен (+ и −)','Опция пересчёта розничной по марже']) }, '📥 Импорт прайса EKF'),
      el('button', { class: 'btn btn-primary', onclick: openNewProduct }, '+ Товар'),
    ]),
  ]));

  // Категории плиткой
  const filterCat = { id: null };
  wrap.append(el('div', { style:'font-weight:600;margin:8px 0 12px;font-size:14px' }, 'Категории'));
  const tiles = el('div', { class: 'cat-grid' });
  state.categories.forEach(c => {
    const tile = el('div', { class: 'cat-tile' }, [
      el('div', { class:'cat-icon' }, c.icon),
      el('div', { class:'cat-name' }, c.name),
      el('div', { class:'cat-count' }, c.count + ' SKU'),
    ]);
    tile.onclick = () => {
      filterCat.id = filterCat.id === c.id ? null : c.id;
      $$('.cat-tile', wrap).forEach(t => t.classList.remove('active'));
      if (filterCat.id) tile.classList.add('active');
      refresh();
      if (filterCat.id) {
        toast(`Фильтр: ${c.name}`, 'info');
        // прокрутка к таблице
        wrap.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast('Фильтр снят', 'info');
      }
    };
    tiles.append(tile);
  });
  wrap.append(tiles);

  // Таблица товаров
  const productsTitle = el('div', { style:'font-weight:600;margin:24px 0 12px;font-size:14px' }, 'Все товары (демо ' + state.products.length + ')');
  wrap.append(productsTitle);
  const tw = el('div', { class: 'table-wrap' });
  const searchI = el('input', { placeholder:'Поиск по артикулу или названию…', oninput: e => { filterQ = e.target.value.toLowerCase(); refresh(); } });
  const catSel = el('select', { onchange: e => { filterCat.id = e.target.value || null; refresh(); } },
    [el('option', { value:'' }, 'Все категории')].concat(state.categories.map(c => el('option', { value: c.id }, c.name))));
  const brandSel = el('select', { onchange: e => { filterBrand = e.target.value; refresh(); } },
    [el('option', { value:'' }, 'Все бренды'), el('option', { value:'EKF' }, 'EKF'), el('option', { value:'KazКабель' }, 'KazКабель'), el('option', { value:'WAGO' }, 'WAGO'), el('option', { value:'КВТ' }, 'КВТ')]);
  let filterQ = '';
  let filterBrand = '';

  tw.append(el('div', { class: 'table-toolbar' }, [searchI, catSel, brandSel]));
  const t = el('table', { class:'data' });
  t.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Артикул'),
    el('th', {}, 'Наименование'),
    el('th', {}, 'Бренд'),
    el('th', { class:'num' }, 'Закуп'),
    el('th', { class:'num' }, 'Опт'),
    el('th', { class:'num' }, 'Розница'),
    el('th', {}, 'Остаток'),
  ])));
  t.append(buildPRows(state.products));
  tw.append(t);
  wrap.append(tw);

  function buildPRows(list) {
    return el('tbody', {}, list.length ? list.map(p => {
      const free = p.stock - p.reserved;
      return el('tr', { onclick: () => openProductDetail(p.id) }, [
        el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, p.sku),
        el('td', { class:'strong' }, p.name),
        el('td', {}, el('span', { class:'tag' }, p.brand)),
        el('td', { class:'num muted' }, fmtMoney(p.priceCost)),
        el('td', { class:'num' }, fmtMoney(p.priceWholesale)),
        el('td', { class:'num strong' }, fmtMoney(p.priceRetail)),
        el('td', {}, stockIndicator(free, p.stock)),
      ]);
    }) : [el('tr', {}, el('td', { colspan: 7, class:'empty', style:'padding:30px;text-align:center' }, 'По фильтру ничего не найдено'))]);
  }
  function refresh() {
    catSel.value = filterCat.id || '';
    const visible = state.products.filter(p => {
      if (filterCat.id && p.cat !== filterCat.id) return false;
      if (filterBrand && p.brand !== filterBrand) return false;
      if (filterQ && !(p.name + p.sku).toLowerCase().includes(filterQ)) return false;
      return true;
    });
    productsTitle.textContent = filterCat.id
      ? `${categoryById(filterCat.id).name} (${visible.length})`
      : 'Все товары (' + visible.length + ')';
    t.querySelector('tbody')?.replaceWith(buildPRows(visible));
  }
  return wrap;
};

// ============================================================
// VIEW: WAREHOUSE
// ============================================================
VIEWS.warehouse = () => {
  const wrap = el('div');
  const totalSku = state.products.length;
  const totalUnits = state.products.reduce((s,p)=>s+p.stock,0);
  const reserved = state.products.reduce((s,p)=>s+p.reserved,0);
  const valueOnHand = state.products.reduce((s,p)=>s+p.stock*p.priceCost,0);

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Склад'),
      el('div', { class: 'sub' }, 'Карагандинский склад · ул. Бытовая, 13/1'),
    ]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => { wrap.querySelector('[data-anchor="receipts"]')?.scrollIntoView({ behavior:'smooth' }); toast('Скроллю к приходам', 'info'); } }, '📦 Приходы'),
      el('button', { class: 'btn', onclick: () => stub('Перемещения между складами', 'У KES пока один склад в Караганде. При расширении: складки в Астане, Алматы, Темиртау — перемещения с актами М-11.') }, '🔄 Перемещения'),
      el('button', { class: 'btn btn-primary', onclick: () => stub('Новая инвентаризация', 'Запустит лист пересчёта с PDA-сканером (или печать листов). Расхождения автоматически создают акты списания/оприходования.') }, '+ Инвентаризация'),
    ]),
  ]));

  const stats = el('div', { class:'grid grid-4' }, [
    statCard('SKU на складе',   totalSku,                '', '', '📦'),
    statCard('Всего единиц',     totalUnits.toLocaleString('ru-RU'), '', '', '🧮'),
    statCard('Зарезервировано', reserved.toLocaleString('ru-RU'),  '', '', '🔒'),
    statCard('Стоимость склада', fmtMoneyK(valueOnHand),  '', '', '💎'),
  ]);
  wrap.append(stats);

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
  tab.append(el('tbody', {}, state.receipts.map(r => {
    const sp = byId(state.suppliers, r.supplier);
    return el('tr', {}, [
      el('td', { class:'strong' }, r.no),
      el('td', {}, fmtDate(r.date)),
      el('td', {}, sp?.name || '—'),
      el('td', { class:'num' }, r.items),
      el('td', { class:'num strong' }, fmtMoneyK(r.amount)),
      el('td', {}, el('span', { class:'pill pill-success' }, r.status)),
      el('td', { class:'muted' }, r.note),
    ]);
  })));
  t.append(tab);
  wrap.append(t);

  // Низкие остатки
  wrap.append(el('div', { style:'font-weight:600;margin:24px 0 12px' }, '⚠️ Требуют дозаказа'));
  const low = state.products
    .map(p => ({ ...p, free: p.stock - p.reserved }))
    .filter(p => p.free < 50)
    .sort((a,b) => a.free - b.free);
  const t2 = el('div', { class:'table-wrap' });
  const tab2 = el('table', { class:'data' });
  tab2.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Артикул'),
    el('th', {}, 'Товар'),
    el('th', { class:'num' }, 'Остаток'),
    el('th', { class:'num' }, 'Резерв'),
    el('th', { class:'num' }, 'Свободно'),
    el('th', {}, ''),
  ])));
  tab2.append(el('tbody', {}, low.length ? low.map(p => el('tr', {}, [
    el('td', { class:'muted', style:'font-family:monospace;font-size:11.5px' }, p.sku),
    el('td', { class:'strong' }, p.name),
    el('td', { class:'num' }, p.stock),
    el('td', { class:'num muted' }, p.reserved),
    el('td', { class:'num' }, stockIndicator(p.free, p.stock)),
    el('td', { class:'num' }, el('button', { class:'btn btn-sm btn-primary', onclick: (ev) => { ev.stopPropagation(); toast(`Создан черновик заказа на ${p.sku} → EKF`, 'success'); } }, 'Заказать')),
  ])) : [el('tr', {}, el('td', { colspan: 6, class:'empty' }, [el('div', { class:'em-icon' }, '✅'), el('div', { class:'em-text' }, 'Все остатки в норме')]))]));
  t2.append(tab2);
  wrap.append(t2);
  return wrap;
};

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
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Задачи'), el('div', { class:'sub' }, `${state.tasks.filter(t=>!t.done).length} открытых · ${state.tasks.filter(t=>t.done).length} выполнено`)]),
    el('div', { class:'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewTask }, '+ Задача')]),
  ]));
  const list = el('div', { class:'card' });
  state.tasks.forEach(t => {
    const u = userById(t.owner);
    list.append(el('div', { class:'activity-item', style:'padding:10px 0;border-bottom:1px solid #F3F4F6' }, [
      el('input', { type:'checkbox', checked: t.done ? 'checked' : null, style:'margin-top:8px;width:18px;height:18px',
        onchange: (e) => { t.done = e.target.checked; saveState(state); toast(t.done ? 'Задача выполнена' : 'Задача возвращена в работу', 'success'); navigate('tasks'); }
      }),
      el('div', { class:'flex-1' }, [
        el('div', { style: t.done ? 'text-decoration:line-through;color:#9CA3AF' : '' }, t.title),
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
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Отчёты'), el('div', { class:'sub' }, 'Май 2026 · ABC-анализ клиентов, продажи по менеджерам и категориям')]),
    el('div', { class:'actions' }, [el('button', { class:'btn', onclick: () => stub('Экспорт PDF отчёта', 'Сформирует красивый PDF: продажи по неделям, ABC-сегментация клиентов, план/факт по менеджерам, разрез по категориям и поставщикам.') }, '📥 Экспорт PDF')]),
  ]));

  // Продажи по неделям — line chart
  const card1 = el('div', { class:'card' });
  card1.append(el('div', { class:'card-head' }, el('h3', {}, 'Продажи по неделям мая (млн ₸)')));
  const cv1 = el('canvas', { style:'max-height:260px' });
  card1.append(el('div', { style:'padding:8px 4px' }, cv1));
  wrap.append(card1);

  // Двойной ряд: pie + bar
  const rowCharts = el('div', { class:'grid grid-2 mt-16' });
  const cardCat = el('div', { class:'card' });
  cardCat.append(el('div', { class:'card-head' }, el('h3', {}, 'Доля продаж по категориям')));
  const cv2 = el('canvas', { style:'max-height:260px' });
  cardCat.append(el('div', { style:'padding:8px 4px' }, cv2));
  rowCharts.append(cardCat);

  const cardMgr = el('div', { class:'card' });
  cardMgr.append(el('div', { class:'card-head' }, el('h3', {}, 'Менеджеры — факт vs план')));
  const cv3 = el('canvas', { style:'max-height:260px' });
  cardMgr.append(el('div', { style:'padding:8px 4px' }, cv3));
  rowCharts.append(cardMgr);
  wrap.append(rowCharts);

  // Рисуем графики после вставки в DOM
  setTimeout(() => {
    if (!window.Chart) return;
    const brand = '#00A6E2';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#6B7280';

    new Chart(cv1.getContext('2d'), {
      type: 'line',
      data: {
        labels: ['нед. 1','нед. 2','нед. 3','нед. 4','нед. 5'],
        datasets: [{
          label: 'Выручка, млн ₸',
          data: [8.2, 11.6, 9.4, 14.8, 12.1],
          borderColor: brand, backgroundColor: brand + '22',
          tension: 0.35, fill: true, borderWidth: 3,
          pointBackgroundColor: brand, pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 6,
        }, {
          label: 'План',
          data: [10, 10, 10, 10, 10],
          borderColor: '#9CA3AF', borderDash: [4,4], borderWidth: 2, fill: false, pointRadius: 0,
        }],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
    });

    // По категориям — считаем долю на основе lineItems всех закрытых сделок
    const catTotals = {};
    state.deals.forEach(d => {
      (d.lineItems || []).forEach(it => {
        const p = byId(state.products, it.product);
        if (!p) return;
        const cat = categoryById(p.cat).name;
        catTotals[cat] = (catTotals[cat] || 0) + it.qty * (it.priceUsed || p.priceWholesale);
      });
    });
    // Если позиций нет — синтезируем демо-разбивку
    if (!Object.keys(catTotals).length) {
      Object.assign(catTotals, {
        'Автоматы EKF': 6400000, 'Кабель и провод': 4200000, 'Щиты': 2800000,
        'Контакторы и реле': 1900000, 'Освещение': 1100000, 'Прочее': 850000,
      });
    }
    const catEntries = Object.entries(catTotals).sort((a,b) => b[1]-a[1]).slice(0, 6);
    new Chart(cv2.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([k]) => k),
        datasets: [{
          data: catEntries.map(([,v]) => v),
          backgroundColor: ['#00A6E2','#7B61FF','#FF9F43','#28C76F','#EF4444','#06B6D4'],
          borderWidth: 2, borderColor: '#fff',
        }],
      },
      options: { responsive: true, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtMoneyK(ctx.parsed) } } } },
    });

    // Менеджеры
    const mgrs = state.users.filter(u => u.roleKey === 'manager').map(u => {
      const sum = state.deals.filter(d => d.manager === u.id && ['paid','shipped','closed'].includes(d.stage)).reduce((s,d)=>s+d.amount,0);
      return { name: u.name.split(' ')[0], sum: Math.round(sum/1_000_000*10)/10, plan: 15 };
    });
    new Chart(cv3.getContext('2d'), {
      type: 'bar',
      data: {
        labels: mgrs.map(m => m.name),
        datasets: [
          { label: 'Факт', data: mgrs.map(m => m.sum), backgroundColor: brand, borderRadius: 6 },
          { label: 'План', data: mgrs.map(m => m.plan), backgroundColor: '#E5E7EB', borderRadius: 6 },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + ' млн ₸' } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'млн ₸' } } } },
    });
  }, 50);

  // ABC + по менеджерам
  const row = el('div', { class:'grid grid-2 mt-16' });

  // ABC клиентов
  const abc = el('div', { class:'card' });
  abc.append(el('div', { class:'card-head' }, el('h3', {}, 'ABC-анализ клиентов (по LTV)')));
  const sorted = [...state.clients].sort((a,b)=>b.ltv-a.ltv);
  const totalLtv = sorted.reduce((s,c)=>s+c.ltv,0);
  let cum = 0;
  const abcTab = el('table', { class:'data' });
  abcTab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Клиент'),
    el('th', { class:'num' }, 'LTV'),
    el('th', { class:'num' }, 'Доля'),
    el('th', {}, 'ABC'),
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
  row.append(abc);

  // По менеджерам
  const mgrs = el('div', { class:'card' });
  mgrs.append(el('div', { class:'card-head' }, el('h3', {}, 'Менеджеры — план/факт')));
  const mgrStats = state.users.filter(u => u.role.includes('Менеджер')).map(u => {
    const my = state.deals.filter(d => d.manager === u.id && ['paid','shipped','closed'].includes(d.stage));
    const sum = my.reduce((s,d)=>s+d.amount,0);
    return { ...u, sum, plan: 15_000_000, count: my.length };
  });
  const mt = el('table', { class:'data' });
  mt.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Менеджер'),
    el('th', { class:'num' }, 'Сделок'),
    el('th', { class:'num' }, 'Факт'),
    el('th', { class:'num' }, 'План'),
    el('th', {}, '%'),
  ])));
  mt.append(el('tbody', {}, mgrStats.map(m => {
    const pct = Math.round(m.sum / m.plan * 100);
    return el('tr', {}, [
      el('td', {}, el('div', { class:'row' }, [
        el('span', { class:'avatar', style:`width:24px;height:24px;font-size:10px;background:${m.color}` }, m.avatar),
        el('span', {}, m.name),
      ])),
      el('td', { class:'num' }, m.count),
      el('td', { class:'num strong' }, fmtMoneyK(m.sum)),
      el('td', { class:'num muted' }, fmtMoneyK(m.plan)),
      el('td', {}, el('div', { class:'bar-mini', style:'min-width:120px' }, el('div', { style:`width:${Math.min(100,pct)}%; background:${pct>=100?'#10B981':'#00A6E2'}` }))),
    ]);
  })));
  mgrs.append(mt);
  row.append(mgrs);

  wrap.append(row);
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
        !isMe && u.active !== false ? el('button', { class:'btn btn-sm', title:'Заблокировать', onclick: () => { u.active = false; saveState(state); toast(u.name + ' заблокирован', 'warn'); navigate('settings'); } }, '🚫') : null,
        !isMe && u.active === false ? el('button', { class:'btn btn-sm', title:'Активировать', onclick: () => { u.active = true; saveState(state); toast(u.name + ' активирован', 'success'); navigate('settings'); } }, '✓') : null,
        !isMe ? el('button', { class:'btn btn-sm', title:'Удалить', onclick: () => { if (confirm('Удалить ' + u.name + '?')) { state.users = state.users.filter(x => x.id !== u.id); saveState(state); toast('Пользователь удалён', 'success'); navigate('settings'); } } }, '🗑') : null,
      ]) : el('span', { class:'muted' }, '—')),
    ]);
  })));
  card.append(tab);
  wrap.append(card);

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

  // Первая страница — первая доступная роли
  const firstView = r.modules[0] || 'dashboard';
  navigate(firstView);
}

// ============================================================
// Init
// ============================================================
bootApp();
