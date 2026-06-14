// KES CRM — рендер, навигация, авторизация. SPA на чистом JS.

// Слой 4: данные приходят из боевого API (api.js), а не из localStorage.
let { STAGES, ROLES, CLIENT_TYPES } = window.__KES__; // переопределяются из БД в loadData()
let PIPELINES = [];                 // воронки продаж — из БД в loadData()
let DEALS_PIPELINE = '';            // id активной воронки (URL #deals/{pipelineId} + localStorage)
const { saveState, resetState } = window.__KES__;
let state = { meta: {}, users: [], categories: [], products: [], clients: [], deals: [], leads: [], suppliers: [], tasks: [], invoices: [], shipments: [], receipts: [], notifications: [] };
let currentUser = null; // заполняется после логина
let CURRENT_VIEW = '';  // текущий активный раздел (для точечного обновления списков)

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

// ============================================================
// ИКОНКИ — инлайн-SVG вместо эмодзи. Один проход по DOM конвертирует
// все эмодзи в иконки (и для будущих ре-рендеров через MutationObserver).
// ============================================================
const ICONS = {
  'bar-chart': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'briefcase': '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'package': '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  'factory': '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M7 18h.01M12 18h.01M17 18h.01"/>',
  'truck': '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'clipboard': '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  'handshake': '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87"/><path d="M3 4h8l-1 10 1.5 1.5a1 1 0 1 1-3 3L3 13z"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'refresh': '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'printer': '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'circle': '<circle cx="12" cy="12" r="9"/>',
  'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  'dollar': '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  'gem': '<polygon points="6 3 18 3 22 9 12 22 2 9"/><path d="M11 3 8 9l4 13 4-13-3-6"/><line x1="2" y1="9" x2="22" y2="9"/>',
  'calculator': '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
  'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'trash': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'camera': '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  'calendar': '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  'hand': '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  'cone': '<path d="M9.3 6.2 4 20h16L14.7 6.2"/><line x1="2" y1="20" x2="22" y2="20"/><line x1="10.5" y1="11" x2="13.5" y2="11"/>',
  'bulb': '<path d="M9 18h6M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  'folder': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'undo': '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  'rotate': '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  'menu': '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'plug': '<path d="M12 22v-5M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  'tool': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'archive': '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
  'sliders': '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'ruler': '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
  'thermometer': '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  'antenna': '<path d="M2 12 7 2M7 12l5-10M12 12l5-10M17 12l5-10M4.5 7h15"/><path d="M12 16v6"/>',
  'traffic': '<rect x="9" y="2" width="6" height="20" rx="3"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  'battery': '<rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="10" x2="23" y2="14"/>',
  'power': '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'magnet': '<path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4M12 15l4 4"/>',
  'cpu': '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  'building': '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
  'receipt': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  'message': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'paperclip': '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'send': '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
};
const EMOJI_ICON = {
  '📊':'bar-chart','📈':'trending-up','📥':'inbox','💼':'briefcase','👥':'users','👤':'user',
  '📦':'package','🏭':'factory','🚚':'truck','📄':'file-text','📋':'clipboard','🤝':'handshake',
  '✅':'check-circle','✓':'check','✗':'x','⚙':'settings','🔄':'refresh','🖨':'printer','🔔':'bell',
  '⚠':'alert-triangle','🔒':'lock','🟡':'circle','🟧':'circle','🟢':'circle','🔴':'circle',
  '💰':'dollar','💎':'gem','🧮':'calculator','💾':'save','🗑':'trash','✏':'edit','🖼':'image',
  '📷':'camera','📅':'calendar','🕒':'clock','⏱':'clock','⏳':'clock','👋':'hand','🚧':'cone',
  '💡':'bulb','🗂':'folder','📁':'folder','🔗':'link','↩':'undo','↺':'rotate','☰':'menu','⚡':'zap',
  '🔌':'plug','🧵':'plug','🧰':'tool','🛠':'tool','🔩':'tool','🗄':'archive','🔧':'wrench','🎛':'sliders',
  '🪜':'package','📏':'ruler','🌡':'thermometer','📡':'antenna','🔘':'circle-dot','🚦':'traffic',
  '🔋':'battery','👔':'briefcase','⏻':'power','🚫':'ban','⌕':'search','🛡':'shield','🔥':'flame',
  '🧲':'magnet','📟':'cpu','🏛':'building','🧾':'receipt','💬':'message','📨':'send','📞':'phone','📲':'phone','📎':'paperclip',
  '→':'arrow-right','←':'arrow-left','↓':'arrow-down','▲':'chevron-up','▼':'chevron-down','▸':'chevron-right','▾':'chevron-down',
};
// 'wrench' если нет — алиас на tool
ICONS.wrench = ICONS.wrench || ICONS.tool;

const EMOJI_RE = new RegExp('(' + Object.keys(EMOJI_ICON).map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?', 'g');

function svgIconEl(name, size) {
  const inner = ICONS[name];
  if (!inner) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size || 16); svg.setAttribute('height', size || 16);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'ic');
  svg.innerHTML = inner;
  return svg;
}
function iconizeTextNode(node) {
  const txt = node.nodeValue;
  if (!txt) return;
  EMOJI_RE.lastIndex = 0;
  if (!EMOJI_RE.test(txt)) return;
  EMOJI_RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0, m;
  while ((m = EMOJI_RE.exec(txt))) {
    if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
    const sv = svgIconEl(EMOJI_ICON[m[1]]);
    frag.appendChild(sv || document.createTextNode(m[0]));
    last = m.index + m[0].length;
  }
  if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
  if (node.parentNode) node.parentNode.replaceChild(frag, node);
}
function iconize(root) {
  if (!root) return;
  if (root.nodeType === 3) { iconizeTextNode(root); return; }
  if (root.nodeType !== 1) return;
  const tag = (root.tagName || '').toLowerCase();
  if (tag === 'svg' || tag === 'script' || tag === 'style') return;
  if (root.closest && root.closest('svg')) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode; if (!p) return NodeFilter.FILTER_REJECT;
      const pt = (p.tagName || '').toLowerCase();
      if (pt === 'script' || pt === 'style' || (p.closest && p.closest('svg'))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = []; let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(iconizeTextNode);
}
let __iconObserver = null;
function startIconObserver() {
  try { iconize(document.body); } catch (e) {}
  if (__iconObserver) return;
  __iconObserver = new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.addedNodes) mu.addedNodes.forEach((nd) => { try { iconize(nd); } catch (e) {} });
    }
  });
  __iconObserver.observe(document.body, { childList: true, subtree: true });
}
// Конвертация эмодзи в SVG для строкового HTML (печатные документы)
function iconizeHTML(html) {
  return String(html).replace(EMOJI_RE, (full, e) => {
    const inner = ICONS[EMOJI_ICON[e]];
    return inner ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px">${inner}</svg>` : full;
  });
}

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
// ----- Воронки продаж -----
const pipelineById = (id) => PIPELINES.find(p => p.id === id);
const defaultPipelineId = () => (PIPELINES[0] && PIPELINES[0].id) || 'default';
const stagePipeline = (stageId) => { const s = STAGES.find(x => x.id === stageId); return s ? s.pipelineId : null; };
const pipelineStages = (pid) => STAGES.filter(s => s.pipelineId === pid).sort((a, b) => (a.sort || 0) - (b.sort || 0));
// Гарантирует, что активная воронка валидна (из URL/localStorage/первая доступная)
function ensureActivePipeline() {
  if (DEALS_PIPELINE && pipelineById(DEALS_PIPELINE)) return;
  let saved = ''; try { saved = localStorage.getItem('kes_deals_pipeline') || ''; } catch (e) {}
  DEALS_PIPELINE = pipelineById(saved) ? saved : defaultPipelineId();
}
// Переключение активной воронки (с сохранением выбора и сбросом фильтра по этапу)
function setDealsPipeline(id, persist = true) {
  DEALS_PIPELINE = id;
  DEALS_STAGE = '';
  if (persist) { try { localStorage.setItem('kes_deals_pipeline', id); } catch (e) {} }
  refreshPipelineNav();
}

// Группа «Сделки» в сайдбаре с раскрывающимся списком воронок
function buildDealsNavGroup(it, isActive) {
  const group = el('div', { class: 'nav-group open', id: 'nav-deals-group' });
  const mainBtn = el('button', { 'data-view': 'deals', class: 'nav-group-main' + (isActive ? ' active' : '') }, [
    el('span', { class: 'icon' }, it.icon),
    ' ' + it.label,
  ]);
  const toggle = el('button', { class: 'nav-group-toggle', id: 'pipeToggle', title: 'Воронки', 'aria-label': 'Воронки' }, '▸');
  group.append(el('div', { class: 'nav-group-row' }, [mainBtn, toggle]), el('div', { class: 'nav-sub', id: 'nav-pipelines' }));
  return group;
}

// Перерисовка списка воронок в сайдбаре (выделяет активную, у директора — правка/удаление/создание)
function refreshPipelineNav() {
  const host = document.getElementById('nav-pipelines');
  if (!host) return;
  ensureActivePipeline();
  host.innerHTML = '';
  const isDirector = currentUser && currentUser.roleKey === 'director';
  PIPELINES.forEach(p => {
    const actions = isDirector ? el('span', { class: 'pipe-actions' }, [
      el('span', { class: 'pipe-edit', title: 'Переименовать', onclick: (e) => { e.stopPropagation(); renamePipeline(p); } }, '✎'),
      PIPELINES.length > 1 ? el('span', { class: 'pipe-del', title: 'Удалить воронку', onclick: (e) => { e.stopPropagation(); deletePipelineUI(p); } }, '×') : null,
    ]) : null;
    const item = el('div', { class: 'pipe-item' + (p.id === DEALS_PIPELINE ? ' active' : ''), title: p.name,
      onclick: () => { setDealsPipeline(p.id); navigate('deals'); document.body.classList.remove('nav-open'); } }, [
      el('span', { class: 'pipe-dot' }),
      el('span', { class: 'pipe-name' }, p.name),
      actions,
    ]);
    host.append(item);
  });
  if (isDirector) host.append(el('button', { class: 'pipe-add', onclick: () => createPipelineUI() }, '+ Новая воронка'));
}

// Создание новой воронки (директор) — со стартовым набором этапов на сервере
function createPipelineUI() {
  const nameI = el('input', { placeholder: 'Например: Оптовые продажи' });
  openModal({
    title: 'Новая воронка',
    body: el('div', {}, [
      el('div', { class: 'form-row' }, [el('label', {}, 'Название'), nameI]),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, 'Будут созданы стандартные этапы: Новая, КП отправлено, Согласовано, Счёт выставлен, Оплачено, Отгружено, Закрыта, Отказ — их можно изменить.'),
    ]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async (e) => {
        const name = nameI.value.trim();
        if (!name) { nameI.focus(); return; }
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const saved = await window.__API__.apiFetch('pipelines', { method: 'POST', body: { name } });
          await loadData();            // подтянуть этапы новой воронки
          setDealsPipeline(saved.id);
          closeModal(); navigate('deals'); toast('Воронка создана', 'success');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); btn.disabled = false; }
      } }, 'Создать'),
    ],
  });
  setTimeout(() => nameI.focus(), 30);
}

// Переименование воронки (директор)
function renamePipeline(p) {
  const nameI = el('input', { value: p.name });
  openModal({
    title: 'Переименовать воронку',
    body: el('div', { class: 'form-row' }, [el('label', {}, 'Название'), nameI]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const name = nameI.value.trim();
        if (!name) { nameI.focus(); return; }
        try {
          await window.__API__.apiFetch('pipelines/' + encodeURIComponent(p.id), { method: 'PUT', body: { name } });
          p.name = name;
          refreshPipelineNav();
          closeModal(); toast('Переименовано', 'success');
          const onDeals = document.querySelector('#nav .nav-group-main.active');
          if (onDeals && DEALS_PIPELINE === p.id) navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Сохранить'),
    ],
  });
  setTimeout(() => { nameI.focus(); nameI.select(); }, 30);
}

// Удаление воронки (директор) — с подтверждением; сделки переносятся в другую воронку
async function deletePipelineUI(p) {
  if (PIPELINES.length <= 1) { toast('Нельзя удалить единственную воронку', 'warn'); return; }
  const inPipe = state.deals.filter(d => stagePipeline(d.stage) === p.id).length;
  const msg = inPipe
    ? `В воронке «${p.name}» есть сделки (${inPipe}). При удалении они будут перенесены в другую воронку. Удалить?`
    : `Удалить воронку «${p.name}»?`;
  if (!(await confirmModal({ title:'Удаление воронки', message: msg, confirmText:'Удалить', danger:true }))) return;
  try {
    await window.__API__.apiFetch('pipelines/' + encodeURIComponent(p.id), { method: 'DELETE' });
    await loadData();
    if (!pipelineById(DEALS_PIPELINE)) setDealsPipeline(defaultPipelineId());
    else refreshPipelineNav();
    navigate('deals'); toast('Воронка удалена', 'success');
  } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
}
const userById = (id) => byId(state.users, id) || { name: '—', avatar: '?', color: '#999' };
const clientById = (id) => byId(state.clients, id) || { name: '—' };
const categoryById = (id) => byId(state.categories, id) || { name: '—', icon: '·' };

// ---------- Роутер ----------
const VIEWS = {};
const ROUTES = [
  'dashboard','leads','deals','clients','catalog','warehouse',
  'shipments','invoices','suppliers','tasks','reports','settings','archive'
];

function navigate(view, params = {}, noHash = false) {
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
  CURRENT_VIEW = view;
  const main = $('#main');
  main.innerHTML = '';
  const renderer = VIEWS[view] || VIEWS.dashboard;
  if (!noHash) updateHash(view, false); // синхронизируем URL (#view?...состояние) до рендера
  main.append(renderer(params));
}

document.addEventListener('click', (e) => {
  // раскрытие/сворачивание списка воронок
  const pipeToggle = e.target.closest('#pipeToggle');
  if (pipeToggle) { e.stopPropagation(); const g = document.getElementById('nav-deals-group'); if (g) g.classList.toggle('open'); return; }
  const navBtn = e.target.closest('#nav button[data-view]');
  if (navBtn) {
    if (navBtn.dataset.view === 'deals') { const g = document.getElementById('nav-deals-group'); if (g) g.classList.add('open'); }
    if (navBtn.dataset.view === 'tasks') TASKS_VIEW = 'kanban'; // при входе в раздел — всегда канбан
    navigate(navBtn.dataset.view); document.body.classList.remove('nav-open'); return;
  }
  const navLink = e.target.closest('[data-nav]');
  if (navLink) {
    e.preventDefault();
    const params = JSON.parse(navLink.dataset.params || '{}');
    if (navLink.dataset.nav === 'tasks' && !params.view) TASKS_VIEW = 'kanban';
    navigate(navLink.dataset.nav, params);
    document.body.classList.remove('nav-open');
  }
});

// ============================================================
// URL-роутинг (hash): #deals, #catalog?... — прямые ссылки, состояние в URL
// ============================================================
const ROUTE_STATE = {
  deals: {
    serialize: () => {
      const p = {};
      if (DEALS_VIEW === 'list') p.view = 'list';
      if (DEALS_Q) p.q = DEALS_Q;
      if (DEALS_STAGE) p.stage = DEALS_STAGE;
      if (DEALS_MGR) p.mgr = DEALS_MGR;
      if (DEALS_FROM) p.from = DEALS_FROM;
      if (DEALS_TO) p.to = DEALS_TO;
      return p;
    },
    apply: (p) => {
      DEALS_VIEW = p.view === 'list' ? 'list' : 'kanban';
      DEALS_Q = p.q || ''; DEALS_STAGE = p.stage || ''; DEALS_MGR = p.mgr || '';
      DEALS_FROM = p.from || ''; DEALS_TO = p.to || '';
    },
  },
  tasks: {
    serialize: () => {
      const p = {};
      if (TASKS_VIEW === 'list') p.view = 'list';
      if (TASKS_OWNER) p.owner = TASKS_OWNER;
      if (TASKS_FROM) p.from = TASKS_FROM;
      if (TASKS_TO) p.to = TASKS_TO;
      if (TASKS_SHOWDONE) p.done = '1';
      if (TASKS_STATUS) p.st = TASKS_STATUS;
      return p;
    },
    apply: (p) => {
      TASKS_VIEW = p.view === 'list' ? 'list' : 'kanban';
      TASKS_OWNER = p.owner || ''; TASKS_FROM = p.from || ''; TASKS_TO = p.to || '';
      TASKS_SHOWDONE = p.done === '1';
      TASKS_STATUS = p.st || '';
    },
  },
};
let __routingSuppress = false;
// Текущая открытая карточка-сущность (#deals/{id} | #clients/{id}) — чтобы closeModal вернул URL к списку
let __entityRoute = null;

function buildHash(view) {
  let h = view;
  if (view === 'deals') { ensureActivePipeline(); if (DEALS_PIPELINE) h += '/' + encodeURIComponent(DEALS_PIPELINE); }
  const reg = ROUTE_STATE[view];
  if (reg) {
    const p = reg.serialize();
    const qs = Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
    if (qs) h += '?' + qs;
  }
  return h;
}
function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const path = (qi >= 0 ? raw.slice(0, qi) : raw).trim();
  const seg = path.split('/');
  const view = (seg[0] || '').trim();
  // #clients/{id}; #deals/{pipelineId}; #deals/{pipelineId}/{dealId}
  const id = seg[1] ? decodeURIComponent(seg[1]).trim() : '';
  const sub = seg[2] ? decodeURIComponent(seg[2]).trim() : '';
  const params = {};
  if (qi >= 0) raw.slice(qi + 1).split('&').forEach(kv => {
    if (!kv) return;
    const i = kv.indexOf('=');
    const k = decodeURIComponent(i >= 0 ? kv.slice(0, i) : kv);
    const v = i >= 0 ? decodeURIComponent(kv.slice(i + 1)) : '';
    if (k) params[k] = v;
  });
  return { view, id, sub, params };
}
// Устанавливает URL карточки при открытии и запоминает сущность для возврата
//   сделка  -> #deals/{pipelineId}/{dealId}
//   клиент  -> #clients/{clientId}
function setEntityHash(view, id) {
  __entityRoute = { view, id };
  let target;
  if (view === 'deals') {
    const d = byId(state.deals, id);
    const pid = (d && stagePipeline(d.stage)) || DEALS_PIPELINE || defaultPipelineId();
    target = 'deals/' + encodeURIComponent(pid) + '/' + encodeURIComponent(id);
  } else {
    target = view + '/' + encodeURIComponent(id);
  }
  if (String(location.hash || '').replace(/^#\/?/, '') === target) return; // уже стоит (открыли по ссылке)
  __routingSuppress = true;
  location.hash = target; // запись в историю — кнопка «назад» закроет карточку
}
function updateHash(view, replace) {
  const target = buildHash(view);
  if (String(location.hash || '').replace(/^#\/?/, '') === target) return;
  if (replace && history.replaceState) {
    history.replaceState(null, '', '#' + target);   // без события hashchange и без записи в историю
  } else {
    __routingSuppress = true;
    location.hash = target;
  }
}
function routeFromHash() {
  const { view, id, sub, params } = parseHash();
  if (view && ROUTES.includes(view) && currentUser && can('see-module', view)) {
    if (ROUTE_STATE[view]) { try { ROUTE_STATE[view].apply(params); } catch (e) {} }
    if (view === 'deals') {
      // форматы: #deals/{pipelineId}, #deals/{pipelineId}/{dealId}, #deals/{dealId} (старый)
      let pid = id, dealId = sub;
      if (id && !pipelineById(id) && !sub) { dealId = id; pid = ''; } // одиночный сегмент = сделка
      if (pid && pipelineById(pid)) setDealsPipeline(pid, true); else ensureActivePipeline();
      if (dealId) { navigate('deals', params, true); openDealDetail(dealId); return; }
      if (__entityRoute) { __entityRoute = null; const mm = $('#modal'); if (mm) mm.classList.remove('show'); }
      navigate('deals', params);
      return;
    }
    if (view === 'clients' && id) {
      navigate('clients', params, true);             // рендерим список-основу, не затирая URL карточки
      openClientDetail(id);
      return;
    }
    // в URL больше нет id, а карточка открыта (напр. кнопка «назад») — закрываем её
    if (__entityRoute) { __entityRoute = null; const mm = $('#modal'); if (mm) mm.classList.remove('show'); }
    navigate(view, params);
  } else {
    navigate((currentUser && role().modules[0]) || 'dashboard');
  }
}
// Карточка не найдена по ID — страница «не найдено»
function showNotFound(view, id) {
  __entityRoute = { view, id };
  openModal({
    title: 'Не найдено',
    body: el('div', { class: 'empty', style: 'padding:48px 20px;text-align:center' }, [
      el('div', { class: 'em-icon', style: 'font-size:44px' }, '🔍'),
      el('div', { class: 'em-text', style: 'margin-top:10px;font-weight:600;font-size:16px' }, (view === 'clients' ? 'Клиент' : 'Сделка') + ' не найдена'),
      el('div', { class: 'muted', style: 'margin-top:6px' }, 'Запись с идентификатором «' + id + '» не существует или была удалена.'),
    ]),
    foot: [el('button', { class: 'btn btn-primary', onclick: closeModal }, '← К списку')],
  });
}
window.addEventListener('hashchange', () => {
  if (__routingSuppress) { __routingSuppress = false; return; } // мы сами поменяли hash — не перерисовываем повторно
  if (!currentUser) return;                                     // до логина не роутим
  routeFromHash();
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
function openModal({ title, body, foot = [], wide = false }) {
  const box = document.querySelector('#modal .modal');
  if (box) box.classList.toggle('modal-xl', !!wide);
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = '';
  $('#modal-body').append(body);
  $('#modal-foot').innerHTML = '';
  foot.forEach(b => $('#modal-foot').append(b));
  $('#modal').classList.add('show');
}
function closeModal() {
  const m = $('#modal'); if (m) m.classList.remove('show');
  const box = document.querySelector('#modal .modal'); if (box) box.classList.remove('modal-xl');
  // если закрыли карточку-сущность — возвращаем URL к списку (без записи в историю)
  if (__entityRoute) { const v = __entityRoute.view; __entityRoute = null; updateHash(v, true); }
}
// Делегированные обработчики через document — переживают перерисовку body
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal-close') closeModal();
  if (e.target.id === 'modal') closeModal();
});

// ---------- Единая система модальных диалогов (замена native alert/confirm/prompt) ----------
// Отдельный оверлей #cmodal стекается поверх обычного #modal, поэтому подтверждения
// можно показывать даже когда открыта карточка сущности. Фон затемнён, клик вне окна
// или «Отмена»/Esc — закрывают, взаимодействие с остальным UI заблокировано.
function _cmodalRender({ title, message, icon, foot, onDismiss }) {
  const overlay = $('#cmodal');
  $('#cmodal-title').textContent = title;
  const body = $('#cmodal-body'); body.innerHTML = '';
  body.append(el('div', { style:'display:flex;gap:12px;align-items:flex-start' }, [
    icon ? el('div', { style:'font-size:24px;line-height:1.1' }, icon) : null,
    el('div', { style:'white-space:pre-line;font-size:14px;line-height:1.55' }, message || ''),
  ]));
  const footEl = $('#cmodal-foot'); footEl.innerHTML = '';
  foot.forEach(b => footEl.append(b));
  let settled = false;
  const finish = (cb, val) => { if (settled) return; settled = true; cleanup(); cb(val); };
  function onKey(e) { if (e.key === 'Escape') onDismiss.fn(); }
  function onBackdrop(e) { if (e.target === overlay || e.target.id === 'cmodal-close') onDismiss.fn(); }
  function cleanup() {
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('click', onBackdrop);
  }
  overlay.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
  overlay.classList.add('show');
  return finish;
}
// Подтверждение действия (удаление, смена статуса, архивирование и т.п.) → Promise<boolean>
function confirmModal(opts = {}) {
  if (typeof opts === 'string') opts = { message: opts };
  const { title = 'Подтверждение', message = '', confirmText = 'Подтвердить', cancelText = 'Отмена', danger = false, icon = '' } = opts;
  return new Promise((resolve) => {
    const onDismiss = {};
    const cancelBtn = el('button', { class:'btn' }, cancelText);
    const okBtn = el('button', { class:'btn ' + (danger ? 'btn-danger' : 'btn-primary') }, confirmText);
    const finish = _cmodalRender({ title, message, icon: icon || (danger ? '⚠️' : ''), foot: [cancelBtn, okBtn], onDismiss });
    onDismiss.fn = () => finish(resolve, false);
    cancelBtn.onclick = () => finish(resolve, false);
    okBtn.onclick = () => finish(resolve, true);
    setTimeout(() => okBtn.focus(), 30);
  });
}
// Информационное сообщение (успех/ошибка/предупреждение/инфо) → Promise<void>
function messageModal(opts = {}) {
  if (typeof opts === 'string') opts = { message: opts };
  const { title = 'Сообщение', message = '', type = 'info', okText = 'Понятно' } = opts;
  const iconMap = { info:'ℹ️', success:'✓', warn:'⚠️', error:'✗' };
  return new Promise((resolve) => {
    const onDismiss = {};
    const okBtn = el('button', { class:'btn btn-primary' }, okText);
    const finish = _cmodalRender({ title, message, icon: iconMap[type] || '', foot: [okBtn], onDismiss });
    onDismiss.fn = () => finish(resolve);
    okBtn.onclick = () => finish(resolve);
    setTimeout(() => okBtn.focus(), 30);
  });
}

// ---------- Единая выезжающая панель фильтров (как в «Отчётах») ----------
// groups — массив DOM-узлов (обычно .filter-group). countActive() → число активных фильтров (для бейджа).
function buildFilterDrawer({ title = 'Фильтры', groups = [], onReset, countActive } = {}) {
  const badge = el('span', { style:'display:none;margin-left:6px;background:var(--brand);color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600' }, '');
  const btn = el('button', { class:'btn', onclick: () => open() }, [svgIconEl('filter', 16), ' Фильтры', badge]);
  const backdrop = el('div', { class:'drawer-backdrop', onclick: () => close() });
  const drawer = el('div', { class:'filter-drawer' }, [
    el('div', { class:'fd-head' }, [
      el('h3', { style:'margin:0;font-size:15px' }, title),
      el('button', { class:'fd-close', title:'Закрыть', onclick: () => close() }, '×'),
    ]),
    el('div', { class:'fd-body' }, groups),
    el('div', { class:'fd-foot' }, [
      el('button', { class:'btn', style:'flex:1', onclick: () => { if (onReset) onReset(); refreshBadge(); } }, 'Сбросить'),
      el('button', { class:'btn btn-primary', style:'flex:1', onclick: () => close() }, 'Готово'),
    ]),
  ]);
  function open() { backdrop.classList.add('open'); drawer.classList.add('open'); }
  function close() { backdrop.classList.remove('open'); drawer.classList.remove('open'); }
  function refreshBadge() { const n = countActive ? countActive() : 0; badge.textContent = n; badge.style.display = n ? '' : 'none'; }
  refreshBadge();
  return { btn, backdrop, drawer, open, close, refreshBadge };
}
// Хелпер группы фильтра для выезжающей панели
function filterGroup(label, control) {
  return el('div', { class:'filter-group' }, [el('label', {}, label), control]);
}

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

// ---------- Дата: нормализация и поле «Срок» (ручной ввод + календарь) ----------
function isoToDmy(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
function dmyToIso(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (!m) return '';
  const d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}`;
}
// Авто-вставка разделителей при ручном вводе: «15032026» → «15.03.2026»
function autoFormatDmy(s) {
  const d = String(s || '').replace(/\D/g, '').slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '.' + d.slice(2, 4);
  if (d.length > 4) out += '.' + d.slice(4, 8);
  return out;
}
// Поле даты: текстовый ввод с авто-форматом ДД.ММ.ГГГГ + кнопка-календарь.
// Нативный date-input скрыт (служит только пикером) — без браузерного «ДД» вида.
function fDateField(label, initialISO) {
  const iso0 = String(initialISO || '').slice(0, 10);
  const text = el('input', { type: 'text', placeholder: 'ДД.ММ.ГГГГ', value: isoToDmy(iso0), inputmode: 'numeric', maxlength: '10', style: 'flex:1;min-width:120px' });
  const pick = el('input', { type: 'date', value: iso0, class: 'crm-cal-native', tabindex: '-1' });
  const calBtn = el('button', { type: 'button', class: 'btn btn-sm crm-cal-btn', title: 'Выбрать в календаре', onclick: () => {
    const iso = dmyToIso(text.value); if (iso) pick.value = iso;
    try { pick.showPicker(); } catch (_) { pick.focus(); pick.click(); }
  } }, '📅');
  text.oninput = () => {
    text.value = autoFormatDmy(text.value);
    const iso = dmyToIso(text.value);
    if (iso) pick.value = iso;
  };
  pick.onchange = () => { if (pick.value) text.value = isoToDmy(pick.value); };
  const box = el('div', { class: 'crm-datefield' }, [text, calBtn, pick]);
  return {
    row: el('div', { class: 'form-row' }, [el('label', {}, label), box]),
    // храним как «YYYY-MM-DD 18:00» (сохраняет дефолтный дедлайн-час и логику просрочки)
    get: () => { const iso = dmyToIso(text.value) || pick.value; return iso ? iso + ' 18:00' : ''; },
    getDate: () => dmyToIso(text.value) || pick.value || '',
  };
}

// Время: авто-вставка двоеточия («1430» → «14:30») + валидация 00:00–23:59
function autoFormatTime(s) {
  const d = String(s || '').replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
}
function timeValid(s) { return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(s || '').trim()); }
function fTimeField(label, initial) {
  const inp = el('input', { type: 'text', placeholder: 'ЧЧ:ММ', value: initial || '', inputmode: 'numeric', maxlength: '5', style: 'width:90px' });
  const hint = el('span', { class: 'muted', style: 'font-size:11px;margin-left:8px' }, '');
  inp.oninput = () => {
    inp.value = autoFormatTime(inp.value);
    const ok = inp.value === '' || timeValid(inp.value);
    inp.style.borderColor = ok ? '' : '#EF4444';
    hint.textContent = ok ? '' : 'неверное время';
  };
  return {
    row: el('div', { class: 'form-row' }, [el('label', {}, label), el('div', { class: 'row', style: 'align-items:center' }, [inp, hint])]),
    get: () => (timeValid(inp.value) ? inp.value : ''),
    raw: () => inp.value,
  };
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
function openNewTask(dealId) {
  const linkedDeal = (typeof dealId === 'string') ? dealId : null; // привязка к сделке (если из карточки)
  const today = new Date().toISOString().slice(0,10);
  const title = fInput('Название');
  const desc = fTextarea('Описание', '');
  const owner = fSelect('Ответственный',
    state.users.map(u => ({ value: u.id, label: u.name + ' · ' + u.role })),
    state.users[0].id);
  const prio = fSelect('Приоритет',
    [{value:'low',label:'низкий'},{value:'medium',label:'средний'},{value:'high',label:'высокий'}],
    'medium');
  const due = fDateField('Дата окончания', today);
  const time = fTimeField('Время выполнения', '18:00');
  openModal({
    title: 'Новая задача',
    body: el('div', {}, [title.row, desc.row, owner.row, prio.row, due.row, time.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!title.get().trim()) { toast('Введите название', 'warn'); return; }
        if (!due.getDate()) { toast('Укажите дату окончания', 'warn'); return; }
        if (time.raw() && !time.get()) { toast('Неверное время (формат ЧЧ:ММ)', 'warn'); return; }
        const t = {
          title: title.get().trim(), description: desc.get(), owner: owner.get(),
          due: due.getDate() + ' ' + (time.get() || '18:00'),
          deal: linkedDeal, priority: prio.get(),
        };
        try {
          const saved = await window.__API__.apiFetch('tasks', { method: 'POST', body: window.__API__.toApi.task(t) });
          state.tasks.unshift(window.__API__.map.task(saved));
          closeModal(); toast('Задача добавлена', 'success');
          if (linkedDeal) openDealDetail(linkedDeal, { tab: 'tasks' }); else navigate('tasks');
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
  const bin = fInput('БИН');
  const contact = fInput('Контакт');
  const phone = fInput('Телефон');
  const email = fInput('Email');
  const note = fTextarea('Примечание');
  openModal({
    title: 'Новый поставщик',
    body: el('div', {}, [name.row, bin.row, contact.row, phone.row, email.row, note.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!name.get().trim()) { toast('Введите название', 'warn'); return; }
        const sp = { name: name.get().trim(), bin: bin.get(), contact: contact.get(), phone: phone.get(), email: email.get(), share: 0, lastDelivery: new Date().toISOString().slice(0,10), note: note.get() };
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
  // Адрес сделки: из самой сделки, иначе из клиента
  const dealAddress = (d) => { if (!d) return ''; if (d.address) return d.address; const cl = clientById(d.client); return (cl && cl.address) || ''; };

  // ----- Поле «Сделка»: поиск + список (как в карточке сделки, раздел «Товары») -----
  let selectedDealId = null;
  const dealSearch = el('input', { placeholder:'Поиск сделки по названию/клиенту…', style:'width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;outline:none' });
  const dealListEl = el('div', { class:'product-picker' });
  const selectedLabel = el('div', { class:'muted', style:'font-size:12px;margin-top:6px' }, 'Сделка не выбрана');
  const dealRow = el('div', { class:'form-row' }, [el('label', {}, 'Сделка'), el('div', {}, [dealSearch, dealListEl, selectedLabel])]);

  const date = fInput('Дата', new Date().toISOString().slice(0,10), { type: 'date' });
  const transport = fSelect('Транспорт',
    ['Газель собственная','Самовывоз','Транспортная Astana Trans','Курьер','Other'].map(v => ({ value: v, label: v })),
    'Газель собственная');
  const driver = fInput('Водитель', 'Куаныш А.');
  // Адрес — редактируемое поле, автозаполняется из выбранной сделки
  const destInput = el('input', { placeholder:'Адрес доставки' });
  const destRow = el('div', { class:'form-row' }, [el('label', {}, 'Адрес доставки'), destInput]);

  function selectDeal(d) {
    selectedDealId = d.id;
    const cl = clientById(d.client);
    selectedLabel.textContent = '✓ Выбрана: ' + (d.title || '—') + (cl && cl.name ? ' · ' + cl.name : '');
    selectedLabel.style.cssText = 'font-size:12px;margin-top:6px;color:#10B981;font-weight:600';
    destInput.value = dealAddress(d); // автоподстановка адреса (пусто, если нет)
    fillDeals(dealSearch.value);       // обновляем подсветку выбранной строки
  }
  function fillDeals(q = '') {
    const ql = String(q || '').trim().toLowerCase();
    dealListEl.innerHTML = '';
    const rows = state.deals.filter(d => {
      const cl = clientById(d.client);
      return !ql || String(d.title || '').toLowerCase().includes(ql) || String(cl && cl.name || '').toLowerCase().includes(ql);
    }).slice(0, 50);
    if (!rows.length) { dealListEl.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Сделки не найдены')); return; }
    rows.forEach(d => {
      const cl = clientById(d.client); const addr = dealAddress(d);
      const active = d.id === selectedDealId;
      dealListEl.append(el('div', { class:'pp-item', style: active ? 'background:var(--brand-soft)' : '', onclick: () => selectDeal(d) }, [
        el('div', {}, [el('div', {}, d.title || '—'), el('div', { class:'pp-sku' }, (cl ? cl.name : '—') + (addr ? ' · ' + addr : ''))]),
        active ? el('span', { class:'pp-price', style:'color:#10B981' }, '✓') : null,
      ]));
    });
  }
  let dt; dealSearch.oninput = (e) => { const v = e.target.value; clearTimeout(dt); dt = setTimeout(() => fillDeals(v), 200); };
  fillDeals();

  openModal({
    title: 'Новая отгрузка',
    body: el('div', {}, [dealRow, date.row, transport.row, driver.row, destRow]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!selectedDealId) { toast('Выберите сделку из списка', 'warn'); dealInput.focus(); return; }
        const d = byId(state.deals, selectedDealId);
        const sh = {
          no: 'ТТН-0' + (515 + state.shipments.length),
          deal: selectedDealId, client: (d && d.client) || (state.clients[0] && state.clients[0].id),
          date: date.get(), items: (d && d.items) || 1, weight: 0,
          transport: transport.get(), driver: driver.get(), status: 'planned', destination: destInput.value.trim(),
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
  // Поле «Сделка»: поиск + список (как в окне отгрузки)
  let selectedDealId = null;
  const dealSearch = el('input', { placeholder:'Поиск сделки по названию/клиенту…', style:'width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;outline:none' });
  const dealListEl = el('div', { class:'product-picker' });
  const selectedLabel = el('div', { class:'muted', style:'font-size:12px;margin-top:6px' }, 'Сделка не выбрана');
  const dealRow = el('div', { class:'form-row' }, [el('label', {}, 'По сделке'), el('div', {}, [dealSearch, dealListEl, selectedLabel])]);

  const amountInput = el('input', { type:'number', placeholder:'Сумма, ₸' });
  const amountRow = el('div', { class:'form-row' }, [el('label', {}, 'Сумма, ₸'), amountInput]);
  const due = fInput('Срок оплаты', '', { type: 'date' });

  function selectDeal(d) {
    selectedDealId = d.id;
    const cl = clientById(d.client);
    selectedLabel.textContent = '✓ Выбрана: ' + (d.title || '—') + (cl && cl.name ? ' · ' + cl.name : '');
    selectedLabel.style.cssText = 'font-size:12px;margin-top:6px;color:#10B981;font-weight:600';
    if (!amountInput.value && d.amount) amountInput.value = Math.round(d.amount); // подставляем сумму сделки
    fillDeals(dealSearch.value);
  }
  function fillDeals(q = '') {
    const ql = String(q || '').trim().toLowerCase();
    dealListEl.innerHTML = '';
    const rows = state.deals.filter(d => {
      const cl = clientById(d.client);
      return !ql || String(d.title || '').toLowerCase().includes(ql) || String(cl && cl.name || '').toLowerCase().includes(ql);
    }).slice(0, 50);
    if (!rows.length) { dealListEl.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Сделки не найдены')); return; }
    rows.forEach(d => {
      const cl = clientById(d.client); const active = d.id === selectedDealId;
      dealListEl.append(el('div', { class:'pp-item', style: active ? 'background:var(--brand-soft)' : '', onclick: () => selectDeal(d) }, [
        el('div', {}, [el('div', {}, d.title || '—'), el('div', { class:'pp-sku' }, cl ? cl.name : '—')]),
        el('span', { class:'pp-price' }, fmtMoneyK(d.amount || 0)),
      ]));
    });
  }
  let dt; dealSearch.oninput = (e) => { const v = e.target.value; clearTimeout(dt); dt = setTimeout(() => fillDeals(v), 200); };
  fillDeals();

  openModal({
    title: 'Новый счёт',
    body: el('div', {}, [dealRow, amountRow, due.row]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!selectedDealId) { toast('Выберите сделку из списка', 'warn'); dealSearch.focus(); return; }
        const d = byId(state.deals, selectedDealId);
        const iv = {
          no: 'СФ-2026-0' + (240 + state.invoices.length),
          deal: selectedDealId, client: d && d.client, date: new Date().toISOString().slice(0,10),
          amount: +amountInput.value || 0, status: 'pending', due: due.get(),
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

// Автосоздание отгрузки из сделки — данные заполняются из сделки/клиента.
async function autoCreateShipmentForDeal(d) {
  const cl = clientById(d.client);
  const sh = {
    no: 'ТТН-0' + (515 + state.shipments.length),
    deal: d.id, client: d.client,
    date: new Date().toISOString().slice(0, 10),
    items: d.items || (d.lineItems ? d.lineItems.length : 0) || 0,
    weight: 0, transport: 'Газель собственная', driver: '',
    status: 'planned', destination: d.address || (cl && cl.address) || '',
  };
  const saved = await window.__API__.apiFetch('shipments', { method: 'POST', body: window.__API__.toApi.shipment(sh) });
  const mapped = window.__API__.map.shipment(saved);
  state.shipments.unshift(mapped);
  return mapped;
}

// Автосоздание счёта из сделки — данные заполняются из сделки/клиента.
async function autoCreateInvoiceForDeal(d) {
  const due = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10); // срок оплаты +5 дней
  const iv = {
    no: 'СФ-2026-0' + (240 + state.invoices.length),
    deal: d.id, client: d.client, date: new Date().toISOString().slice(0, 10),
    amount: d.amount || 0, status: 'pending', due,
  };
  const saved = await window.__API__.apiFetch('invoices', { method: 'POST', body: window.__API__.toApi.invoice(iv) });
  const mapped = window.__API__.map.invoice(saved);
  state.invoices.unshift(mapped);
  return mapped;
}

// Двусторонняя синхронизация: статус отгрузки → этап связанной сделки.
// (обратное направление — этап сделки → статус отгрузки — делает бэкенд writeDeal)
async function setShipmentStatus(s, status) {
  const prev = s.status;
  s.status = status; // s — ссылка из state.shipments, обновляется сразу везде
  try {
    const saved = await window.__API__.apiFetch('shipments/' + s.id, { method: 'PUT', body: { status_id: status } });
    if (saved) Object.assign(s, window.__API__.map.shipment(saved));
    const d = byId(state.deals, s.deal);
    if (d) {
      const stages = pipelineStages(stagePipeline(d.stage)) || [];
      let target = null;
      if (status === 'delivered') target = stages.find(st => /достав|закры|выполн|заверш/i.test(st.label || ''));
      else if (status === 'shipped') target = stages.find(st => /отгруж/i.test(st.label || ''));
      if (target && target.id !== d.stage) {
        d.stage = target.id;
        await window.__API__.apiFetch('deals/' + d.id, { method: 'PUT', body: { stage_id: target.id } });
      }
    }
    return true;
  } catch (err) { s.status = prev; toast('Не удалось обновить статус отгрузки', 'error'); return false; }
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
        el('dt', {}, 'Сделка'),    el('dd', {}, d ? d.title : '—'),
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
      el('button', { class:'btn btn-primary', onclick: async () => { if (await setShipmentStatus(s, 'delivered')) { closeModal(); toast('Отгрузка доставлена · сделка синхронизирована', 'success'); if (CURRENT_VIEW) navigate(CURRENT_VIEW); } } }, '✓ Доставлено'),
    ],
  });
}

function openInvoiceDetail(id) {
  const iv = byId(state.invoices, id);
  if (!iv) return;
  const cl = clientById(iv.client);
  const d = byId(state.deals, iv.deal);
  // Статус документа синхронизируется только через сами документы (общий state.invoices),
  // этапы сделки на статус не влияют. Объект iv — ссылка из state, поэтому статус
  // сразу актуален во всех разделах.
  const setStatus = async (status, msg) => {
    const prev = iv.status; iv.status = status;
    try {
      const saved = await window.__API__.apiFetch('invoices/' + iv.id, { method: 'PUT', body: { status_id: status } });
      if (saved) Object.assign(iv, window.__API__.map.invoice(saved)); // объект из state синхронизируется с сервером
      closeModal(); toast(msg, 'success');
      if (CURRENT_VIEW) navigate(CURRENT_VIEW); // перерисовать открытый раздел, чтобы статус обновился везде
    } catch (err) { iv.status = prev; toast('Не удалось сохранить', 'error'); }
  };
  const isPaid = iv.status === 'paid';
  openModal({
    title: 'Счёт ' + iv.no,
    body: el('div', {}, [
      el('dl', { class:'kv' }, [
        el('dt', {}, 'Клиент'),  el('dd', { class:'strong' }, cl.name + ' · БИН ' + cl.bin),
        el('dt', {}, 'Сделка'),  el('dd', {}, d ? d.title : '—'),
        el('dt', {}, 'Дата'),    el('dd', {}, fmtDate(iv.date)),
        el('dt', {}, 'Сумма'),    el('dd', { class:'strong', style:'font-size:18px' }, fmtMoney(iv.amount)),
        el('dt', {}, 'Срок'),    el('dd', {}, fmtDate(iv.due)),
        el('dt', {}, 'Статус'),   el('dd', {}, el('span', { class:'pill ' + (isPaid ? 'pill-success' : iv.status === 'overdue' ? 'pill-danger' : 'pill-warn') }, isPaid ? 'Оплачено' : iv.status === 'overdue' ? 'Просрочка' : 'Ожидает')),
      ]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: () => { const dl = byId(state.deals, iv.deal); if (dl) printInvoice(dl); else toast('Сделка не найдена', 'warn'); } }, '🖨 PDF'),
      isPaid
        ? el('button', { class:'btn btn-danger', onclick: () => setStatus('pending', 'Оплата отменена — ожидает') }, '↩ Отменить оплату')
        : el('button', { class:'btn btn-primary', onclick: () => setStatus('paid', 'Счёт оплачен') }, '✓ Оплачено'),
    ],
  });
}

function openSupplierDetail(id) {
  const sp = byId(state.suppliers, id);
  if (!sp) return;
  // Редактируемые поля поставщика
  const fName = fInput('Наименование', sp.name || '');
  const fBin = fInput('БИН', sp.bin || '');
  const fContact = fInput('Контактное лицо', sp.contact || '');
  const fPhone = fInput('Телефон', sp.phone || '');
  const fEmail = fInput('Email', sp.email || '', { type: 'email' });
  const fShare = fInput('Доля закупок, %', sp.share != null ? sp.share : '', { type: 'number' });
  const fDelivery = fDateField('Последняя поставка', String(sp.lastDelivery || '').slice(0, 10));
  const fNote = fTextarea('Комментарий', sp.note || '');
  const fields = [fName, fBin, fContact, fPhone, fEmail, fShare, fDelivery, fNote];

  async function save(btn) {
    if (btn) btn.disabled = true;
    const upd = {
      id: sp.id, name: fName.get().trim() || sp.name, bin: fBin.get(), contact: fContact.get(), phone: fPhone.get(),
      email: fEmail.get(), share: Number(fShare.get()) || 0, lastDelivery: fDelivery.getDate(), note: fNote.get(),
    };
    try {
      const saved = await window.__API__.apiFetch('suppliers/' + sp.id, { method:'PUT', body: window.__API__.toApi.supplier(upd) });
      Object.assign(sp, window.__API__.map.supplier(saved)); // sp — ссылка из state.suppliers → синхронно
      closeModal(); toast('Поставщик сохранён', 'success'); navigate('suppliers');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); if (btn) btn.disabled = false; }
  }
  async function del() {
    if (!(await confirmModal({ title:'Удаление поставщика', message:`Удалить поставщика «${sp.name}»?`, confirmText:'Удалить', danger:true }))) return;
    try {
      await window.__API__.apiFetch('suppliers/' + sp.id, { method:'DELETE' });
      const i = state.suppliers.findIndex(x => x.id === sp.id); if (i >= 0) state.suppliers.splice(i, 1);
      closeModal(); toast('Поставщик удалён', 'success'); navigate('suppliers');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
  }

  openModal({
    title: 'Поставщик · ' + sp.name,
    body: el('div', {}, fields.map(f => f.row)),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Закрыть'),
      el('button', { class:'btn btn-danger', onclick: del }, 'Удалить'),
      el('button', { class:'btn btn-primary', onclick: (e) => save(e.currentTarget) }, 'Сохранить'),
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
// Задачи текущего пользователя на сегодня (живая подсказка).
// Просроченные приходят отдельными адресными уведомлениями (см. scan-overdue).
function taskReminders() {
  return visibleTasks()
    .filter(t => !t.done && taskDue(t).kind === 'today')
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
          <div>По сделке: <b>${deal.title}</b></div>
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
  return iconizeHTML(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
    <link rel="stylesheet" href="${location.origin}/styles.css">
  </head><body style="background:#F4F5F7;padding:20px">
    <div class="print-controls">
      <button onclick="window.print()" class="btn btn-primary">🖨 Печать / PDF</button>
      <button onclick="window.close()" class="btn">Закрыть</button>
    </div>
    <div class="print-area">${inner}</div>
  </body></html>`);
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
        <div class="pr-meta">${deal ? `<div>По сделке: <b>${deal.title}</b></div>` : ''}<div style="margin-top:6px;color:#888">Образец — не имеет юридической силы</div></div>
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

// Печать накладной по складскому документу (приход/расход)
function printStockDoc(docId) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { toast('Браузер заблокировал окно печати — разрешите popup', 'error'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#666">Готовлю накладную…</body>');
  (async () => {
    let doc; try { doc = await window.__API__.apiFetch('stock-docs/' + docId); } catch (e) { w.document.body.innerHTML = 'Документ не найден'; return; }
    const isIn = doc.type === 'receipt';
    const m = state.meta || {};
    const company = m.legalName || m.tenant || 'ТОО «KazEnergoSnab»';
    const dateStr = doc.date ? fmtDate(doc.date) : '';
    const items = doc.items || [];
    const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const statusRu = { draft:'черновик', posted:'проведён', cancelled:'отменён' }[doc.status] || doc.status;
    const rows = items.length
      ? items.map((it, i) => `<tr><td>${i+1}</td><td>${it.product_name||''}</td><td style="font-family:monospace;font-size:11px">${it.product_sku||''}</td><td class="num">${it.qty}</td></tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center;color:#999;padding:14px">Нет позиций</td></tr>`;
    const title = (isIn ? 'ПРИХОДНАЯ НАКЛАДНАЯ' : 'РАСХОДНАЯ НАКЛАДНАЯ') + ' ' + doc.no;
    const inner = `
      <div class="pr-head">
        <div class="pr-logo">${PRINT_LOGO}<div><h2>${title}</h2><div style="color:#666;font-size:12px;margin-top:4px">от ${dateStr} · статус: ${statusRu}</div></div></div>
        <div class="pr-meta"><div>${company}</div>${m.bin ? `<div>БИН: ${m.bin}</div>` : ''}<div style="margin-top:6px;color:#888">Образец — не имеет юридической силы</div></div>
      </div>
      <div class="pr-parties">
        <div><div class="party-title">${isIn ? 'Поставщик' : 'Отправитель'}</div><div class="party-name">${isIn ? (doc.counterparty || '—') : company}</div>${isIn ? '' : `<div class="party-line">${m.address || ''}</div>`}</div>
        <div><div class="party-title">${isIn ? 'Склад / получатель' : 'Получатель'}</div><div class="party-name">${isIn ? company : (doc.counterparty || '—')}</div>${isIn ? `<div class="party-line">${m.address || ''}</div>` : ''}</div>
      </div>
      <table class="pr-table"><thead><tr><th style="width:32px">#</th><th>Наименование</th><th style="width:130px">Артикул</th><th class="num" style="width:80px">Кол-во</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="pr-totals"><div class="total-line grand"><span>Всего единиц:</span> <span>${totalQty}</span></div></div>
      ${doc.note ? `<div style="margin-top:8px;color:#555">Примечание: ${doc.note}</div>` : ''}
      <div class="pr-foot">
        <div><div>Отпустил: ____________________</div><div style="margin-top:12px">Принял: ____________________</div><div style="margin-top:4px;color:#aaa">М.П.</div></div>
        <div class="pr-stamp">место<br>печати</div>
      </div>`;
    w.document.open(); w.document.write(buildPrintDoc(title, inner)); w.document.close();
  })();
}

// Отчёт «Движение приход-расход» за период (печать)
function printMovementsReport(from, to) {
  const w = window.open('', '_blank', 'width=1000,height=1100');
  if (!w) { toast('Браузер заблокировал окно — разрешите popup', 'error'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;color:#666">Готовлю отчёт…</body>');
  (async () => {
    const qp = new URLSearchParams({ limit: '1000' });
    if (from) qp.set('from', from); if (to) qp.set('to', to);
    let rows; try { rows = await window.__API__.apiFetch('stock-movements?' + qp.toString()); } catch (e) { w.document.body.innerHTML = 'Ошибка загрузки'; return; }
    rows = rows || [];
    const inSum = rows.filter(m => m.direction === 'in').reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const outSum = rows.filter(m => m.direction === 'out').reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const period = (from ? fmtDate(from) : '…') + ' — ' + (to ? fmtDate(to) : '…');
    const m = state.meta || {};
    const body = rows.length
      ? rows.map((mv, i) => `<tr><td>${i+1}</td><td>${mv.date ? fmtDate(mv.date) : ''}</td><td>${mv.direction === 'in' ? 'Приход' : 'Расход'}</td><td>${mv.product_name || mv.product_sku || ''}</td><td class="num">${mv.direction === 'in' ? '+' : '−'}${mv.qty}</td><td>${mv.counterparty || ''}</td><td>${mv.doc_no || ''}</td></tr>`).join('')
      : `<tr><td colspan="7" style="text-align:center;color:#999;padding:14px">Движений за период нет</td></tr>`;
    const inner = `
      <div class="pr-head">
        <div class="pr-logo">${PRINT_LOGO}<div><h2>ОТЧЁТ: ДВИЖЕНИЕ ПРИХОД-РАСХОД</h2><div style="color:#666;font-size:12px;margin-top:4px">за период ${period}</div></div></div>
        <div class="pr-meta"><div>${m.legalName || m.tenant || 'ТОО «KazEnergoSnab»'}</div><div style="margin-top:6px;color:#888">Сформировано в CRM</div></div>
      </div>
      <table class="pr-table"><thead><tr><th style="width:32px">#</th><th style="width:90px">Дата</th><th style="width:80px">Тип</th><th>Товар</th><th class="num" style="width:80px">Кол-во</th><th style="width:160px">Контрагент</th><th style="width:90px">Документ</th></tr></thead><tbody>${body}</tbody></table>
      <div class="pr-totals">
        <div class="total-line"><span>Итого приход:</span> <span>+${inSum}</span></div>
        <div class="total-line"><span>Итого расход:</span> <span>−${outSum}</span></div>
        <div class="total-line grand"><span>Сальдо (приход − расход):</span> <span>${inSum - outSum}</span></div>
      </div>`;
    w.document.open(); w.document.write(buildPrintDoc('Движение приход-расход', inner)); w.document.close();
  })();
}

// Модалка выбора периода для отчёта движения
function openMovementsReport() {
  const fromI = el('input', { type:'date' });
  const toI = el('input', { type:'date', value: new Date().toISOString().slice(0, 10) });
  openModal({
    title: 'Отчёт: движение приход-расход',
    body: el('div', {}, [
      el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Укажите период (пусто = без ограничения).'),
      el('div', { class:'form-row' }, [el('label', {}, 'Период с'), fromI]),
      el('div', { class:'form-row' }, [el('label', {}, 'по'), toI]),
    ]),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class:'btn btn-primary', onclick: () => { closeModal(); printMovementsReport(fromI.value, toI.value); } }, '🖨 Сформировать'),
    ],
  });
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
      el('div', { class:'di-body' }, [el('div', { class:'strong' }, d.title), el('div', { class:'di-time' }, clientById(d.client).name + ' · ' + fmtMoneyK(d.amount))]),
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
  ]));

  // 4 KPI карточки
  const stats = el('div', { class: 'grid grid-4' });
  stats.append(statCard('Выручка (закрыто)', fmtMoneyK(totalRevenue), '', '', '💰'));
  stats.append(statCard('Пайплайн',          fmtMoneyK(pipelineValue), '', '', '📈'));
  stats.append(statCard('Дебиторка',         fmtMoneyK(debtTotal), overdueCount ? overdueCount + ' просрочка' : '', '', '⚠️'));
  stats.append(statCard('Открытые сделки',   myDeals.filter(d => !['closed','lost'].includes(d.stage)).length, '', '', '💼'));
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
  ensureActivePipeline();
  const funnelStages = pipelineStages(DEALS_PIPELINE);
  const maxByStage = Math.max(...funnelStages.map(s => myDeals.filter(d => d.stage === s.id).reduce((sum,d)=>sum+d.amount,0)));
  funnelStages.forEach(s => {
    if (s.id === 'lost' || s.id === 'closed') return;
    const dealsOnStage = myDeals.filter(d => d.stage === s.id);
    const sum = dealsOnStage.reduce((a,d)=>a+d.amount,0);
    const w = maxByStage ? Math.max(2, Math.round(sum / maxByStage * 100)) : 0;
    funnel.append(el('div', { class: 'funnel-row', style:'cursor:pointer', title:`Открыть сделки на этапе «${s.label}»`,
      onclick: () => { DEALS_VIEW = 'kanban'; DEALS_STAGE = s.id; DEALS_Q = ''; DEALS_MGR = ''; DEALS_FROM = ''; DEALS_TO = ''; navigate('deals'); } }, [
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
    actList.append(el('div', { class: 'activity-item clickable', title: 'Открыть задачу', onclick: () => openTaskDetail(t.id) }, [
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
        el('div', { class: 'muted' }, clientById(d.client).name),
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
let DEALS_VIEW = 'kanban'; // 'kanban' | 'list'
let DEALS_Q = '', DEALS_STAGE = '', DEALS_MGR = '', DEALS_FROM = '', DEALS_TO = '';
let FOCUS_STAGE = null; // id этапа, чьё поле названия фокусируем после ре-рендера
const STAGE_PROTECTED = new Set(['paid', 'shipped', 'lost']); // нельзя переименовывать/удалять

VIEWS.deals = () => {
  ensureActivePipeline();
  const wrap = el('div');
  const isList = DEALS_VIEW === 'list';
  const all = visibleDeals();
  const selected = new Set(); // выбранные сделки (список) для массового редактирования
  const pipe = pipelineById(DEALS_PIPELINE);
  const activeStages = () => pipelineStages(DEALS_PIPELINE);

  const subEl = el('div', { class: 'sub' });
  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', {}, (pipe && pipe.name) || 'Сделки'), subEl]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', onclick: () => { DEALS_VIEW = isList ? 'kanban' : 'list'; navigate('deals'); } }, isList ? '🗂 Канбан' : '📋 Список'),
      el('button', { class: 'btn btn-primary', onclick: () => openNewDeal() }, '+ Сделка'),
    ]),
  ]));

  // Тулбар: поиск всегда виден, остальные фильтры — за кнопкой «Фильтры»
  const searchI = el('input', { placeholder:'Поиск по названию, клиенту…', value: DEALS_Q, style:'flex:1;min-width:160px' });
  const stageSel = el('select', {}, [el('option', { value:'' }, 'Все этапы'), ...activeStages().map(s => el('option', { value:s.id }, s.label))]);
  stageSel.value = DEALS_STAGE;
  stageSel.onchange = () => { DEALS_STAGE = stageSel.value; renderContent(); };
  let mgrSel = null;
  if (role().seeAllData) {
    mgrSel = el('select', {}, [el('option', { value:'' }, 'Все менеджеры'), ...state.users.filter(u => u.active !== false).map(u => el('option', { value:u.id }, u.name))]);
    mgrSel.value = DEALS_MGR;
    mgrSel.onchange = () => { DEALS_MGR = mgrSel.value; renderContent(); };
  }
  const fromI = el('input', { type:'date', value: DEALS_FROM });
  const toI = el('input', { type:'date', value: DEALS_TO });
  fromI.onchange = () => { DEALS_FROM = fromI.value; renderContent(); };
  toI.onchange = () => { DEALS_TO = toI.value; renderContent(); };
  const drawer = buildFilterDrawer({
    groups: [
      filterGroup('Этап', stageSel),
      ...(mgrSel ? [filterGroup('Менеджер', mgrSel)] : []),
      filterGroup('Период создания', el('div', { class:'row2' }, [fromI, toI])),
    ],
    onReset: () => { DEALS_STAGE=''; DEALS_MGR=''; DEALS_FROM=''; DEALS_TO=''; stageSel.value=''; if (mgrSel) mgrSel.value=''; fromI.value=''; toI.value=''; renderContent(); },
    countActive: () => [DEALS_STAGE, DEALS_MGR, DEALS_FROM, DEALS_TO].filter(Boolean).length,
  });
  let sd; searchI.oninput = () => { clearTimeout(sd); sd = setTimeout(() => { DEALS_Q = searchI.value; renderContent(); }, 200); };
  wrap.append(el('div', { class:'table-toolbar', style:'margin-bottom:12px' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  wrap.append(drawer.backdrop, drawer.drawer);

  const content = el('div');
  wrap.append(content);

  function filtered() {
    const q = String(DEALS_Q || '').trim().toLowerCase();
    const stageIds = new Set(activeStages().map(s => s.id)); // только сделки активной воронки
    const r = all.filter(d => {
      if (!stageIds.has(d.stage)) return false;
      if (DEALS_MGR && d.manager !== DEALS_MGR) return false;
      if (DEALS_STAGE && d.stage !== DEALS_STAGE) return false;
      if (DEALS_FROM || DEALS_TO) {
        const dd = String(d.created || '').slice(0, 10);
        if (!dd) return false;
        if (DEALS_FROM && dd < DEALS_FROM) return false;
        if (DEALS_TO && dd > DEALS_TO) return false;
      }
      if (q) {
        const cl = clientById(d.client);
        if (!(String(d.no || '').toLowerCase().includes(q) || String(d.title || '').toLowerCase().includes(q) || String(cl && cl.name || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
    return r.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  }

  function renderContent() {
    selected.clear(); // при перестроении списка выбор сбрасывается
    updateHash('deals', true); // отражаем фильтры в URL (без записи в историю)
    drawer.refreshBadge();
    const deals = filtered();
    subEl.textContent = `${deals.length} ${role().seeAllData ? 'сделок' : 'ваших сделок'} · сумма ${fmtMoneyK(deals.reduce((s, d) => s + d.amount, 0))}`;
    content.innerHTML = '';
    content.append(isList ? buildDealsTable(deals) : buildDealsKanban(deals));
  }

  function buildDealsTable(deals) {
    const tw = el('div', { class: 'table-wrap' });

    // Панель массового редактирования (показывается при выборе)
    const countSpan = el('span', { class:'strong' }, '');
    const rowChecks = [];
    const selAll = el('input', { type:'checkbox', title:'Выбрать все по фильтру' });
    const isDir = currentUser && currentUser.roleKey === 'director';
    const delBtn = isDir ? el('button', { class:'btn btn-sm btn-danger', onclick: () => bulkDeleteDeals() }, '🗑 Удалить') : null;
    const bulkBar = el('div', { class:'bulk-bar', style:'display:none' }, [
      countSpan,
      el('button', { class:'btn btn-sm btn-primary', onclick: () => openBulkEdit([...selected]) }, 'Массовое редактирование'),
      delBtn,
      el('button', { class:'btn btn-sm', onclick: () => { selected.clear(); rowChecks.forEach(c => { c.checked = false; }); selAll.checked = false; refreshBulk(); } }, 'Снять выбор'),
    ]);
    function refreshBulk() { countSpan.textContent = `Выбрано: ${selected.size}`; bulkBar.style.display = selected.size ? '' : 'none'; }
    async function bulkDeleteDeals() {
      const ids = [...selected]; if (!ids.length) return;
      if (!(await confirmModal({ title:'Подтверждение удаления', message:'Вы уверены, что хотите удалить выбранные элементы? Они будут перемещены в архив на 30 дней.', confirmText:'Удалить', cancelText:'Отмена', danger:true }))) return;
      if (delBtn) delBtn.disabled = true;
      try {
        for (const id of ids) {
          await window.__API__.apiFetch('deals/' + id, { method:'DELETE' });
          const idx = state.deals.findIndex(x => x.id === id); if (idx >= 0) state.deals.splice(idx, 1);
        }
        toast(`Перемещено в архив: ${ids.length}`, 'success');
        selected.clear(); navigate('deals');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); if (delBtn) delBtn.disabled = false; }
    }
    selAll.onchange = () => { deals.forEach((d, i) => { if (selAll.checked) selected.add(d.id); else selected.delete(d.id); if (rowChecks[i]) rowChecks[i].checked = selAll.checked; }); refreshBulk(); };

    const t = el('table', { class:'data' });
    t.append(el('thead', {}, el('tr', {}, [
      el('th', { style:'width:34px;text-align:center' }, selAll),
      el('th', {}, 'Сделка'), el('th', {}, 'Клиент'), el('th', {}, 'Менеджер'),
      el('th', {}, 'Этап'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Создана'), el('th', {}, 'Срок'),
    ])));
    t.append(el('tbody', {}, deals.length ? deals.map((d, i) => {
      const cl = clientById(d.client); const m = userById(d.manager); const s = stageById(d.stage);
      const cb = el('input', { type:'checkbox', onclick: (e) => e.stopPropagation(), onchange: () => { if (cb.checked) selected.add(d.id); else selected.delete(d.id); selAll.checked = deals.length > 0 && deals.every(x => selected.has(x.id)); refreshBulk(); } });
      rowChecks[i] = cb;
      return el('tr', { style:'cursor:pointer', onclick: () => openDealDetail(d.id) }, [
        el('td', { style:'text-align:center', onclick: (e) => e.stopPropagation() }, cb),
        el('td', { class:'strong' }, d.title),
        el('td', {}, cl ? cl.name : '—'),
        el('td', {}, el('span', { class:'avatar', style:`background:${m.color};width:26px;height:26px;font-size:11px`, title:m.name }, m.avatar)),
        el('td', {}, el('span', { class:'pill', style:`background:${s.color}22;color:${s.color}` }, s.label)),
        el('td', { class:'num strong' }, fmtMoneyK(d.amount)),
        el('td', { class:'muted' }, d.created ? fmtDate(d.created) : '—'),
        el('td', { class:'muted' }, d.target ? fmtDate(d.target) : '—'),
      ]);
    }) : [el('tr', {}, el('td', { colspan:8, class:'muted', style:'text-align:center;padding:24px' }, 'Сделок не найдено'))]));
    tw.append(bulkBar, t);
    refreshBulk();
    return tw;
  }

  function buildDealsKanban(deals) {
    let dragged = null;
    const kanban = el('div', { class: 'kanban' });

    // Авто-прокрутка доски при перетаскивании у края экрана
    const EDGE = 70, SPEED = 22;
    let hDir = 0, vDir = 0, rafId = null;
    const mainEl = () => kanban.closest('.main') || document.querySelector('.main');
    function autoStep() {
      if (hDir) kanban.scrollLeft += hDir * SPEED;
      if (vDir) { const m = mainEl(); if (m) m.scrollTop += vDir * SPEED; }
      rafId = (hDir || vDir) ? requestAnimationFrame(autoStep) : null;
    }
    function stopAuto() { hDir = 0; vDir = 0; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    kanban.addEventListener('dragover', (e) => {
      if (!dragged) return;
      const r = kanban.getBoundingClientRect();
      hDir = e.clientX < r.left + EDGE ? -1 : (e.clientX > r.right - EDGE ? 1 : 0);
      vDir = e.clientY < EDGE ? -1 : (e.clientY > window.innerHeight - EDGE ? 1 : 0);
      if ((hDir || vDir) && !rafId) rafId = requestAnimationFrame(autoStep);
      else if (!hDir && !vDir) stopAuto();
    });

    const canStages = currentUser && currentUser.roleKey === 'director';
    const stages = activeStages();
    stages.forEach((s, idx) => {
      const dealsOnStage = deals.filter(d => d.stage === s.id);
      const body = el('div', { class: 'k-col-body' });
      dealsOnStage.forEach(d => {
        const cl = clientById(d.client); const m = userById(d.manager);
        const canDragThis = can('edit-deal', d);
        const card = el('div', { class: 'k-card', draggable: canDragThis ? 'true' : null, onclick: () => openDealDetail(d.id) }, [
          el('div', { class: 'k-card-title' }, d.title),
          el('div', { class: 'k-card-foot mt-12' }, [
            el('span', { style:'display:flex;align-items:center;gap:6px;min-width:0' }, [
              el('span', { class: 'avatar', style: `background:${m.color};width:22px;height:22px;font-size:9px`, title: m.name }, m.avatar),
              el('span', { class: 'muted', style:'font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, m.name),
            ]),
            el('span', { class: 'muted', style:'font-size:11px;flex:none' }, fmtDate(d.created)),
          ]),
        ]);
        if (canDragThis) {
          card.addEventListener('dragstart', (e) => { dragged = { id: d.id }; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch(_){} });
          card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragged = null; stopAuto(); });
        }
        body.appendChild(card);
      });
      // Заголовок этапа. Защищённые (Оплачено/Отгружено/Отказ) — без правки, удаления и «+».
      const protectedStage = !!s.protected || STAGE_PROTECTED.has(s.id);
      const canManageThis = canStages && !protectedStage;
      let labelEl;
      if (canManageThis) {
        labelEl = el('input', { class:'stage-label-input', value: s.label, title:'Кликните, чтобы изменить название' });
        const saveLabel = () => {
          const v = labelEl.value.trim();
          if (!v || v === s.label) { labelEl.value = s.label; return; }
          s.label = v;
          window.__API__.apiFetch('deal_stages/' + encodeURIComponent(s.id), { method:'PUT', body:{ label: v } }).catch(() => toast('Название не сохранено', 'error'));
        };
        let lt; labelEl.oninput = () => { clearTimeout(lt); lt = setTimeout(saveLabel, 600); };
        labelEl.onblur = () => { clearTimeout(lt); saveLabel(); };
        labelEl.onkeydown = (e) => { if (e.key === 'Enter') labelEl.blur(); };
      } else {
        labelEl = el('span', { class: 'stage-label' }, s.label);
      }
      const headKids = [el('span', { class: 'stage-dot', style: `background:${s.color}` }), labelEl, el('span', { class: 'stage-count' }, dealsOnStage.length)];
      if (canManageThis) {
        headKids.push(el('button', { class:'stage-del', title:'Удалить этап', onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmModal({ title:'Удаление этапа', message:`Удалить этап «${s.label}»? Его сделки перейдут на другой этап.`, confirmText:'Удалить', danger:true }))) return;
          try {
            const res = await window.__API__.apiFetch('deal_stages/' + encodeURIComponent(s.id), { method:'DELETE' });
            if (res && res.reassignedTo) state.deals.forEach(d => { if (d.stage === s.id) d.stage = res.reassignedTo; });
            const i = STAGES.findIndex(x => x.id === s.id); if (i >= 0) STAGES.splice(i, 1);
            renderContent(); toast('Этап удалён', 'success');
          } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
        } }, '×'));
        headKids.push(el('button', { class:'stage-add', title:'Добавить этап после этого', onclick: async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget; btn.disabled = true;
          const cur = stages[idx], next = stages[idx + 1];
          const sort = next ? ((Number(cur.sort) || 0) + (Number(next.sort) || 0)) / 2 : (Number(cur.sort) || 0) + 1;
          try {
            const saved = await window.__API__.apiFetch('deal_stages', { method:'POST', body:{ label:'Новый этап', color:'#9CA3AF', sort, pipeline_id: DEALS_PIPELINE } });
            STAGES.push({ id: saved.id, label: saved.label, color: saved.color, sort: saved.sort != null ? saved.sort : sort, pipelineId: DEALS_PIPELINE });
            FOCUS_STAGE = saved.id;
            renderContent();
          } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); btn.disabled = false; }
        } }, '+'));
      }
      const col = el('div', { class: 'k-col', 'data-stage': s.id }, [
        el('div', { class: 'k-col-head' }, headKids),
        body,
      ]);
      col.addEventListener('dragover', (e) => { if (!dragged) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
      col.addEventListener('dragleave', (e) => { if (e.target === col) col.classList.remove('drag-over'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('drag-over'); stopAuto();
        if (!dragged) return;
        const deal = byId(state.deals, dragged.id);
        if (!deal || deal.stage === s.id) return;
        const fromLabel = stageById(deal.stage).label;
        deal.stage = s.id;
        renderContent();
        try {
          await window.__API__.apiFetch('deals/' + deal.id, { method: 'PUT', body: { stage_id: s.id } });
          toast(`${deal.title.slice(0,30)}: ${fromLabel} → ${s.label}`, 'success');
          if (/отгруж/i.test(s.label || '')) toast('Создано автосписание со склада (накладная)', 'info');
        } catch (err) { toast('Не удалось сохранить этап', 'error'); }
      });
      kanban.append(col);
    });
    if (FOCUS_STAGE) {
      const fid = FOCUS_STAGE; FOCUS_STAGE = null;
      setTimeout(() => { const inp = kanban.querySelector(`.k-col[data-stage="${fid}"] .stage-label-input`); if (inp) { inp.focus(); inp.select(); } }, 40);
    }
    return kanban;
  }

  renderContent();
  return wrap;
};

// Массовое редактирование выбранных сделок: заполните нужные поля (пустые — не меняются)
function openBulkEdit(ids) {
  const total = ids.length;
  if (!total) { toast('Не выбрано ни одной сделки', 'warn'); return; }
  const mgrSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), ...state.users.filter(u => u.active !== false).map(u => el('option', { value:u.id }, u.name))]);
  const stageSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), ...pipelineStages(DEALS_PIPELINE).map(s => el('option', { value:s.id }, s.label))]);
  const titleI = el('input', { placeholder:'Оставьте пустым, чтобы не менять' });
  const fieldRow = (label, ctrl) => el('div', { class:'form-row' }, [el('label', {}, label), ctrl]);

  const applyBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    const body = {};
    if (mgrSel.value) body.manager_id = mgrSel.value;
    if (stageSel.value) body.stage_id = stageSel.value;
    if (titleI.value.trim()) body.title = titleI.value.trim();
    if (!Object.keys(body).length) { toast('Заполните хотя бы одно поле', 'warn'); return; }
    if (!(await confirmModal({ title:'Массовое изменение', message:`Применить изменения к ${total} ${plural(total, 'сделке', 'сделкам', 'сделкам')}?`, confirmText:'Применить' }))) return;
    applyBtn.disabled = true; applyBtn.textContent = 'Применение…';
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(ids.slice(i, i + 8).map(async (id) => {
        try {
          await window.__API__.apiFetch('deals/' + id, { method:'PUT', body });
          const d = byId(state.deals, id);
          if (d) { if ('manager_id' in body) d.manager = body.manager_id; if ('stage_id' in body) d.stage = body.stage_id; if ('title' in body) d.title = body.title; }
          ok++;
        } catch (e) { fail++; }
      }));
    }
    closeModal();
    toast(`Изменено: ${ok}${fail ? ', ошибок ' + fail : ''}`, fail ? 'warn' : 'success');
    navigate('deals');
  } }, 'Применить');

  openModal({
    title: 'Массовое редактирование',
    body: el('div', {}, [
      el('div', { class:'bulk-head' }, ['Выбрано сделок: ', el('b', {}, String(total))]),
      el('p', { class:'muted', style:'font-size:12px;margin:0 0 14px' }, 'Заполните только те поля, которые нужно изменить. Пустые поля останутся без изменений.'),
      fieldRow('Менеджер', mgrSel),
      fieldRow('Этап', stageSel),
      fieldRow('Название', titleI),
    ]),
    foot: [el('button', { class:'btn', onclick: closeModal }, 'Отмена'), applyBtn],
  });
}

// Управление этапами воронки (директор): «+» создаёт этап, имя сохраняется автоматически
function openStageManager() {
  const listHost = el('div');
  const debouncers = new Map();
  let changed = false;

  async function putStage(id, body) {
    try { await window.__API__.apiFetch('deal_stages/' + encodeURIComponent(id), { method:'PUT', body }); changed = true; }
    catch (e) { toast('Не удалось сохранить: ' + ((e && e.message) || e), 'error'); }
  }

  function rowFor(stage) {
    const colorI = el('input', { type:'color', value: stage.color || '#00A6E2', title:'Цвет', style:'width:38px;height:34px;padding:2px;flex:none' });
    colorI.onchange = () => { stage.color = colorI.value; putStage(stage.id, { color: colorI.value }); };
    const labelI = el('input', { value: stage.label || '', placeholder:'Название этапа', style:'flex:1;min-width:140px' });
    const saved = el('span', { class:'muted', style:'font-size:10px;width:54px;flex:none;text-align:right' }, '');
    const doSave = () => {
      const v = labelI.value.trim();
      if (!v || v === stage.label) return;
      stage.label = v; saved.textContent = '…';
      putStage(stage.id, { label: v }).then(() => { saved.textContent = '✓ сохр.'; setTimeout(() => { saved.textContent = ''; }, 1500); });
    };
    labelI.oninput = () => { clearTimeout(debouncers.get(stage.id)); debouncers.set(stage.id, setTimeout(doSave, 600)); };
    labelI.onblur = () => { clearTimeout(debouncers.get(stage.id)); doSave(); };
    const delB = el('button', { class:'btn btn-sm btn-danger', title:'Удалить этап', onclick: async () => {
      if (!(await confirmModal({ title:'Удаление этапа', message:`Удалить этап «${stage.label}»? Его сделки перейдут на другой этап.`, confirmText:'Удалить', danger:true }))) return;
      try { await window.__API__.apiFetch('deal_stages/' + encodeURIComponent(stage.id), { method:'DELETE' }); changed = true; row.remove(); }
      catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); }
    } }, '×');
    const row = el('div', { class:'row', style:'gap:8px;align-items:center;margin-bottom:8px' }, [colorI, labelI, saved, delB]);
    return row;
  }

  STAGES.forEach(s => listHost.append(rowFor({ id: s.id, label: s.label, color: s.color })));

  const addBtn = el('button', { class:'btn btn-sm btn-primary', title:'Добавить этап', onclick: async () => {
    addBtn.disabled = true;
    try {
      const sort = 1000 + listHost.children.length;
      const saved = await window.__API__.apiFetch('deal_stages', { method:'POST', body:{ label:'Новый этап', color:'#9CA3AF', sort } });
      changed = true;
      const r = rowFor({ id: saved.id, label: saved.label, color: saved.color });
      listHost.append(r);
      const inp = r.querySelector('input[type=text]'); if (inp) { inp.focus(); inp.select(); }
    } catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); }
    addBtn.disabled = false;
  } }, '+');

  openModal({
    title: 'Этапы воронки',
    body: el('div', {}, [
      el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-bottom:10px' }, [
        el('span', { class:'muted', style:'font-size:12px' }, 'Название сохраняется автоматически'),
        addBtn,
      ]),
      listHost,
    ]),
    foot: [el('button', { class:'btn btn-primary', onclick: async () => { closeModal(); if (changed) { await loadData(); navigate('deals'); } } }, 'Готово')],
  });
}

async function openDealDetail(id, opts) {
  let d = byId(state.deals, id);
  if (!d) {
    // прямая ссылка #deals/{id}: сделки нет в памяти — тянем из БД
    try {
      d = await window.__API__.loadDeal(id);
      if (!d || !d.id) throw new Error('not found');
      state.deals.push(d);
    } catch (e) { showNotFound('deals', id); return; }
  } else {
    // ленивая подгрузка позиций сделки из БД
    try {
      const full = await window.__API__.loadDeal(id);
      d.lineItems = full.lineItems || [];
      if (full.amount != null) d.amount = full.amount;
      if (full.items != null) d.items = full.items;
    } catch (e) { if (!d.lineItems) d.lineItems = []; }
  }
  // открытая сделка задаёт активную воронку (для корректного возврата к доске)
  const dpid = stagePipeline(d.stage);
  if (dpid && pipelineById(dpid) && dpid !== DEALS_PIPELINE) setDealsPipeline(dpid, true);
  setEntityHash('deals', d.id); // уникальный URL карточки
  if (!d.lineItems) d.lineItems = [];
  // Синхронизация с каталогом: дозагрузим товары позиций, которых нет в памяти
  const missingPids = [...new Set(d.lineItems.map(it => it.product).filter(pid => pid && !byId(state.products, pid)))];
  if (missingPids.length) {
    await Promise.all(missingPids.map(pid => window.__API__.apiFetch('products/' + encodeURIComponent(pid))
      .then(row => { const p = window.__API__.map.product(row); if (p && p.id && !byId(state.products, p.id)) state.products.push(p); })
      .catch(() => {})));
  }
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

  // Сумма позиций (товаров)
  const lineItemsSum = () => d.lineItems.reduce((s, it) => {
    const p = byId(state.products, it.product);
    const price = it.priceUsed != null ? it.priceUsed : (p ? p.priceWholesale : 0);
    return s + it.qty * price;
  }, 0);
  // База — часть суммы сделки, не относящаяся к позициям (ручная сумма).
  // Итоговая сумма сделки = база + позиции, поэтому добавление товара ПРИБАВЛЯЕТСЯ к сумме.
  let baseAmount = Math.max(0, (Number(d.amount) || 0) - lineItemsSum());
  function recomputeAmount() {
    d.amount = baseAmount + lineItemsSum();
    d.items = d.lineItems.reduce((s, it) => s + it.qty, 0);
    totalHost.textContent = fmtMoney(d.amount);
  }

  function renderItems() {
    itemsHost.innerHTML = '';
    const t = el('table', { class:'data line-items-table' });
    t.append(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Товар'),
      el('th', { class:'num', style:'width:60px' }, 'Кол-во'),
      el('th', { class:'num', style:'width:92px' }, 'Цена'),
      el('th', { class:'num', style:'width:96px' }, 'Сумма'),
      el('th', { style:'width:26px' }, ''),
    ])));
    const tb = el('tbody');
    if (!d.lineItems.length) {
      tb.append(el('tr', {}, el('td', { colspan: 5, class:'muted', style:'text-align:center;padding:14px' }, 'Товаров пока нет — добавьте через поиск ниже')));
    } else {
      d.lineItems.forEach((it, idx) => {
        const p = byId(state.products, it.product);
        if (!p) return;
        if (it.priceUsed == null) it.priceUsed = p.priceWholesale || 0;
        const sumCell = el('td', { class:'num strong' }, fmtMoney(it.qty * it.priceUsed));
        const recalc = () => { sumCell.textContent = fmtMoney(it.qty * it.priceUsed); recomputeAmount(); };
        tb.append(el('tr', {}, [
          el('td', {}, [el('div', { style:'font-weight:500' }, p.name), el('div', { class:'muted', style:'font-size:11px' }, p.sku + (p.brand ? ' · ' + p.brand : ''))]),
          el('td', { class:'num' }, canEdit
            ? el('input', { class:'qty', type:'number', min:'1', value: it.qty, oninput: (e) => { it.qty = Math.max(1, +e.target.value || 1); recalc(); } })
            : String(it.qty)),
          el('td', { class:'num' }, canEdit
            ? el('input', { class:'qty', type:'number', min:'0', value: Math.round(it.priceUsed || 0), title:'Цена за единицу', oninput: (e) => { it.priceUsed = Math.max(0, +e.target.value || 0); recalc(); } })
            : el('span', { class:'muted' }, fmtMoney(it.priceUsed))),
          sumCell,
          el('td', {}, canEdit ? el('button', { class:'x-btn', title:'Удалить', onclick: () => { d.lineItems.splice(idx, 1); recomputeAmount(); renderItems(); } }, '×') : null),
        ]));
      });
    }
    t.append(tb);
    itemsHost.append(t);
  }

  function renderPicker() {
    pickerHost.innerHTML = '';
    if (!canEdit) return;
    const search = el('input', { placeholder:'Поиск товара по артикулу/названию…', style:'width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;outline:none' });
    const list = el('div', { class:'product-picker' });
    let seq = 0;
    // Поиск идёт по живому каталогу (актуальные товары и цены), а не по кешу в памяти
    async function fill(q = '') {
      const my = ++seq;
      const ql = q.trim();
      list.innerHTML = '';
      list.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Поиск…'));
      let rows;
      try {
        const resp = await window.__API__.apiFetch('products?limit=50' + (ql ? '&q=' + encodeURIComponent(ql) : ''));
        rows = (resp.data || resp || []).map(window.__API__.map.product);
        rows.forEach(p => { const ex = byId(state.products, p.id); if (ex) Object.assign(ex, p); else state.products.push(p); }); // держим каталог в памяти актуальным
      } catch (e) {
        rows = state.products.filter(p => !ql || (p.name + p.sku).toLowerCase().includes(ql.toLowerCase())).slice(0, 50);
      }
      if (my !== seq) return; // пришёл более свежий запрос
      list.innerHTML = '';
      rows.forEach(p => {
        list.append(el('div', { class:'pp-item', onclick: () => {
          const existing = d.lineItems.find(it => it.product === p.id);
          if (existing) { existing.qty += 1; toast('Количество увеличено', 'info'); }
          else { d.lineItems.push({ product: p.id, qty: 1, priceUsed: p.priceWholesale }); toast('Товар добавлен', 'success'); }
          recomputeAmount(); renderItems();
        } }, [
          el('div', {}, [el('div', {}, p.name), el('div', { class:'pp-sku' }, p.sku + (p.brand ? ' · ' + p.brand : ''))]),
          el('span', { class:'pp-price' }, fmtMoney(p.priceWholesale)),
        ]));
      });
      if (!rows.length) list.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Ничего не найдено'));
    }
    let dt; search.oninput = (e) => { const v = e.target.value; clearTimeout(dt); dt = setTimeout(() => fill(v), 250); };
    fill();
    pickerHost.append(
      el('div', { style:'font-weight:600;font-size:12px;margin:14px 0 6px;color:#6B7280;text-transform:uppercase;letter-spacing:.5px' }, 'Добавить товар из каталога'),
      search, list
    );
  }

  recomputeAmount();
  renderItems();
  renderPicker();

  const clx = cl || { name: '—', phone: '', bin: '' };

  // ----- Воронка-шевроны (этапы воронки этой сделки) -----
  let chosenStage = d.stage;
  const dealStages = pipelineStages(stagePipeline(d.stage)).length ? pipelineStages(stagePipeline(d.stage)) : STAGES;
  const funnel = el('div', { class:'funnel-steps' });
  const renderFunnel = () => {
    funnel.innerHTML = '';
    const curIdx = dealStages.findIndex(st => st.id === chosenStage);
    dealStages.forEach((st, i) => {
      const cls = st.id === chosenStage ? 'active' : (curIdx >= 0 && i < curIdx ? 'done' : '');
      funnel.append(el('div', { class:'funnel-step ' + cls, title: st.label, onclick: () => { if (!canEdit) return; chosenStage = st.id; renderFunnel(); } }, st.label));
    });
  };
  renderFunnel();

  // ----- Левая панель: форма -----
  const titleI = el('input', { value: d.title || '', placeholder:'Название сделки' });
  const addressI = el('input', { value: d.address || '', placeholder:'Адрес объекта / доставки' });
  const amountI = el('input', { type:'number', value: Math.round(d.amount || 0), min:'0' });
  const dealItemsTotal = el('span', {}, fmtMoney(d.amount));
  recomputeAmount = (function (orig) { return function () { orig(); amountI.value = Math.round(d.amount || 0); dealItemsTotal.textContent = fmtMoney(d.amount); }; })(recomputeAmount);
  // Ручной ввод суммы задаёт «базу»; общий итог = база + позиции
  amountI.oninput = () => { const v = Number(amountI.value) || 0; baseAmount = Math.max(0, v - lineItemsSum()); d.amount = v; totalHost.textContent = fmtMoney(d.amount); dealItemsTotal.textContent = fmtMoney(d.amount); };
  const mgrSel = el('select');
  state.users.forEach(u => { const o = el('option', { value:u.id }, u.name); if (u.id === d.manager) o.selected = true; mgrSel.append(o); });
  if (!canEdit) [titleI, addressI, amountI, mgrSel].forEach(i => i.disabled = true);

  // ----- Клиент: редактируемый, с заменой (поиск/выбор) -----
  let currentClient = clx;
  const clientHost = el('div');
  const clientSearch = el('input', { placeholder:'Поиск клиента по имени / БИН / телефону…', style:'width:100%' });
  const clientList = el('div', { class:'product-picker' });
  const clientPicker = el('div', { style:'display:none;margin-top:8px' }, [clientSearch, clientList]);
  function fillClientList(q) {
    clientList.innerHTML = '';
    const ql = String(q || '').toLowerCase().trim();
    const res = state.clients.filter(c => !ql || (c.name + ' ' + (c.bin || '') + ' ' + (c.phone || '')).toLowerCase().includes(ql)).slice(0, 15);
    if (!res.length) { clientList.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Ничего не найдено')); return; }
    res.forEach(c => clientList.append(el('div', { class:'pp-item', onclick: () => {
      currentClient = c; d.client = c.id; clientPicker.style.display = 'none'; renderClient();
      toast('Клиент изменён: ' + c.name, 'success');
    } }, [el('div', {}, [el('div', {}, c.name), el('div', { class:'pp-sku' }, (c.bin ? 'БИН ' + c.bin + ' · ' : '') + (c.phone || '—'))])])));
  }
  clientSearch.oninput = (e) => fillClientList(e.target.value);
  function renderClient() {
    clientHost.innerHTML = '';
    const c = currentClient;
    clientHost.append(
      el('div', { class:'client-block' }, [
        el('div', { class:'client-top' }, [
          el('div', { class:'avatar', style:'background:#6366F1' }, (c.name || '?').slice(0, 1).toUpperCase()),
          el('div', { class:'who' }, [el('div', { class:'nm' }, c.name || '—'), el('div', { class:'ph' }, c.phone || 'телефон не указан')]),
        ]),
        el('div', { class:'cact' }, [
          el('button', { title:'Позвонить', onclick: () => { if (c.phone) location.href = 'tel:' + String(c.phone).replace(/[^\d+]/g, ''); else toast('Телефон не указан', 'warn'); } }, '📞'),
          el('button', { title:'Написать в WhatsApp', onclick: () => switchTab('whatsapp') }, '💬'),
          canEdit ? el('button', { title:'Заменить клиента', onclick: () => { const open = clientPicker.style.display === 'none'; clientPicker.style.display = open ? 'block' : 'none'; if (open) { clientSearch.value = ''; fillClientList(''); setTimeout(() => clientSearch.focus(), 0); } } }, '✏') : null,
        ]),
      ]),
      clientPicker,
    );
  }
  renderClient();

  const fieldRow = (label, input) => el('div', { class:'form-row' }, [el('label', {}, label), input]);
  const printBtn = el('button', { class:'btn btn-sm', onclick: () => printInvoice(d) }, '🖨 Печать СФ');
  const delBtn = (currentUser && currentUser.roleKey === 'director') ? el('button', { class:'btn btn-sm btn-danger', onclick: async () => {
    if (!(await confirmModal({ title:'Удаление сделки', message:`Удалить сделку «${d.title}»? Она переместится в архив на 30 дней, затем удалится навсегда.`, confirmText:'Удалить', danger:true }))) return;
    try {
      await window.__API__.apiFetch('deals/' + d.id, { method:'DELETE' });
      const i = state.deals.findIndex(x => x.id === d.id); if (i >= 0) state.deals.splice(i, 1);
      closeModal(); toast('Сделка перемещена в архив', 'success'); navigate('deals');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
  } }, 'Удалить') : null;

  const left = el('div', { class:'deal-left' }, [
    el('div', { class:'deal-section' }, [
      el('div', { class:'section-title' }, 'О сделке'),
      fieldRow('Название', titleI),
      el('div', { class:'form-row' }, [el('label', {}, 'Клиент'), clientHost]),
      fieldRow('Адрес', addressI),
      fieldRow('Сумма, ₸', amountI),
      fieldRow('Отв. менеджер', mgrSel),
    ]),
    el('div', { class:'deal-actions' }, [printBtn, delBtn]),
  ]);

  // ----- Правая панель: вкладки (Комментарии / WhatsApp / История) -----
  const commentsTA = el('textarea', { placeholder:'Внутренние комментарии по сделке…' });
  commentsTA.value = d.comments || '';
  if (!canEdit) commentsTA.disabled = true;
  const paneComments = el('div', { class:'chat-pane chat-comments', 'data-pane':'comments' }, [commentsTA]);

  // вкладка «Товары» — рядом с WhatsApp
  const paneItems = el('div', { class:'chat-pane chat-items', 'data-pane':'items' }, [
    el('div', { class:'section-title' }, 'Товары сделки'),
    itemsHost,
    pickerHost,
    el('div', { class:'row', style:'justify-content:space-between;margin-top:12px;font-size:14px;font-weight:600' }, [
      el('span', { class:'muted', style:'font-weight:500' }, 'Сумма по товарам:'),
      dealItemsTotal,
    ]),
  ]);

  const chatBody = el('div', { class:'chat-body' });
  const chatInputEl = el('input', { placeholder:'Сообщение…' });
  const paneWhats = el('div', { class:'chat-pane active', 'data-pane':'whatsapp' }, [
    chatBody,
    el('div', { class:'chat-input' }, [
      el('button', { title:'Прикрепить файл', onclick: () => toast('Прикрепление файлов — скоро', 'info') }, '📎'),
      chatInputEl,
      el('button', { title:'Отправить', onclick: () => sendChat() }, '📨'),
    ]),
  ]);

  const histList = el('div', { style:'padding:14px;overflow-y:auto' });
  if (history.length) {
    history.forEach(h => {
      const to = stageById(h.to_stage); const from = h.from_stage ? stageById(h.from_stage) : null;
      histList.append(el('div', { style:'display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #F3F4F6;font-size:12px' }, [
        el('span', { class:'pill', style:`background:${to.color}22;color:${to.color};font-size:11px` }, to.label),
        el('span', { class:'muted' }, (from ? from.label + ' → ' : 'создана') + ' · ' + (h.user_name || '—') + ' · ' + String(h.changed_at || '').slice(0, 16)),
      ]));
    });
  } else histList.append(el('div', { class:'muted', style:'font-size:12px' }, 'История пуста'));
  const paneHist = el('div', { class:'chat-pane', 'data-pane':'history' }, [histList]);

  // ----- Документы: счета клиента (синхронно с разделом «Документы») -----
  const docsList = el('div', { style:'padding:0 14px 14px;overflow-y:auto' });
  function renderDocs() {
    const invs = state.invoices.filter(iv => iv.client === d.client || iv.deal === d.id);
    docsList.innerHTML = '';
    if (!invs.length) {
      docsList.append(el('div', { class:'muted', style:'font-size:12px;padding:8px 0' }, 'Счетов по сделке нет'));
    } else {
      const stMap = { paid:['pill-success','Оплачено'], pending:['pill-warn','Ожидает'], overdue:['pill-danger','Просрочка'] };
      const t = el('table', { class:'data' });
      t.append(el('thead', {}, el('tr', {}, [el('th', {}, '№ счёта'), el('th', {}, 'Дата'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Статус')])));
      t.append(el('tbody', {}, invs.map(iv => {
        const sp = stMap[iv.status] || ['pill-muted', iv.status || '—'];
        return el('tr', { style:'cursor:pointer', onclick: () => { closeModal(); openInvoiceDetail(iv.id); } }, [
          el('td', { class:'strong' }, iv.no),
          el('td', { class:'muted' }, iv.date ? fmtDate(iv.date) : '—'),
          el('td', { class:'num strong' }, fmtMoneyK(iv.amount)),
          el('td', {}, el('span', { class:'pill ' + sp[0] }, sp[1])),
        ]);
      })));
      docsList.append(t);
    }
    docsList.append(el('button', { class:'btn btn-sm btn-primary', style:'margin-top:10px', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await autoCreateInvoiceForDeal(d); renderDocs(); toast('Счёт создан из сделки', 'success'); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); e.currentTarget.disabled = false; }
    } }, '+ Создать счёт из сделки'));
  }
  renderDocs();
  const paneDocs = el('div', { class:'chat-pane', 'data-pane':'docs' }, [el('div', { class:'section-title', style:'padding:12px 14px 6px' }, 'Счета клиента'), docsList]);

  // ----- Отгрузка: связанная отгрузка сделки (двусторонняя синхронизация статуса) -----
  const shipList = el('div', { style:'padding:8px 14px 14px;overflow-y:auto' });
  function renderShip() {
    const ships = state.shipments.filter(s => s.deal === d.id);
    shipList.innerHTML = '';
    if (!ships.length) {
      shipList.append(el('div', { class:'muted', style:'font-size:12px;padding:8px 0' }, 'Отгрузка по сделке не создана'));
      shipList.append(el('button', { class:'btn btn-sm btn-primary', style:'margin-top:8px', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await autoCreateShipmentForDeal(d); renderShip(); toast('Отгрузка создана из сделки', 'success'); }
        catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); e.currentTarget.disabled = false; }
      } }, '+ Создать отгрузку из сделки'));
      return;
    }
    const stMap = { delivered:['pill-success','✓ Доставлена'], planned:['pill-info','⏱ Запланирована'], shipped:['pill-warn','🚚 В пути'] };
    ships.forEach(s => {
      const sp = stMap[s.status] || ['pill-muted', s.status || '—'];
      const sel = el('select', {}, [
        el('option', { value:'planned' }, 'Запланирована'),
        el('option', { value:'shipped' }, 'В пути'),
        el('option', { value:'delivered' }, 'Доставлена'),
      ]);
      sel.value = s.status;
      sel.onchange = async () => {
        if (await setShipmentStatus(s, sel.value)) { chosenStage = d.stage; renderFunnel(); renderShip(); toast('Статус отгрузки и сделки синхронизированы', 'success'); }
        else sel.value = s.status;
      };
      shipList.append(el('div', { class:'card', style:'padding:12px;margin-bottom:10px' }, [
        el('div', { style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
          el('div', { class:'strong' }, s.no),
          el('span', { class:'pill ' + sp[0] }, sp[1]),
        ]),
        el('dl', { class:'kv', style:'margin:0' }, [
          el('dt', {}, 'Сделка'), el('dd', {}, d.title || '—'),
          el('dt', {}, 'Клиент'), el('dd', {}, (clientById(d.client) || {}).name || '—'),
          el('dt', {}, 'Менеджер'), el('dd', {}, (userById(d.manager) || {}).name || '—'),
          el('dt', {}, 'Сумма'), el('dd', {}, d.amount ? fmtMoney(d.amount) : '—'),
          el('dt', {}, 'Дата'), el('dd', {}, s.date ? fmtDate(s.date) : '—'),
          el('dt', {}, 'Адрес'), el('dd', {}, s.destination || '—'),
          el('dt', {}, 'Транспорт'), el('dd', {}, s.transport || '—'),
          el('dt', {}, 'Водитель'), el('dd', {}, s.driver || '—'),
          el('dt', {}, 'Позиций'), el('dd', {}, s.items != null ? s.items : '—'),
        ]),
        canEdit ? el('div', { style:'margin-top:8px' }, [el('label', { class:'muted', style:'font-size:12px;display:block;margin-bottom:4px' }, 'Статус отгрузки'), sel]) : null,
        el('button', { class:'btn btn-sm', style:'margin-top:8px', onclick: () => printShipment(s) }, '🖨 Печать ТТН'),
      ]));
    });
  }
  renderShip();
  const paneShip = el('div', { class:'chat-pane', 'data-pane':'shipment' }, [el('div', { class:'section-title', style:'padding:12px 14px 6px' }, 'Отгрузка'), shipList]);

  // ----- Задачи: синхронно с общим разделом «Задачи» (общий state.tasks) -----
  const tasksList = el('div', { style:'padding:8px 14px 14px;overflow-y:auto' });
  function renderTasks() {
    const tks = state.tasks.filter(tk => tk.deal === d.id);
    tasksList.innerHTML = '';
    if (!tks.length) {
      tasksList.append(el('div', { class:'muted', style:'font-size:12px;padding:8px 0' }, 'Задач по сделке нет'));
    } else {
      tks.forEach(tk => {
        const u = userById(tk.owner);
        const overdue = !tk.done && taskDue(tk).kind === 'overdue';
        const st = tk.done ? ['pill-success','✓ Выполнена'] : overdue ? ['pill-danger','⚠ Просрочена'] : ['pill-warn','⏳ Открыта'];
        const prCls = tk.priority === 'high' ? 'pill-danger' : tk.priority === 'medium' ? 'pill-warn' : 'pill-muted';
        const prLbl = tk.priority === 'high' ? 'высокий' : tk.priority === 'medium' ? 'средний' : 'низкий';
        tasksList.append(el('div', { class:'card', style:'padding:10px 12px;margin-bottom:8px;cursor:pointer', onclick: () => { closeModal(); openTaskDetail(tk.id, d.id); } }, [
          el('div', { style:'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px' }, [
            el('div', { class:'strong', style:'font-size:13px' }, tk.title || '—'),
            el('span', { class:'pill ' + st[0], style:'font-size:11px' }, st[1]),
          ]),
          el('div', { class:'muted', style:'font-size:12px' }, [
            (u && u.name ? u.name.split(' ')[0] : '—') + ' · ' + (tk.due ? fmtDate(String(tk.due).slice(0, 10)) : '—'),
            el('span', { class:'pill ' + prCls, style:'font-size:10px;margin-left:6px' }, prLbl),
          ]),
        ]));
      });
    }
    tasksList.append(el('button', { class:'btn btn-sm btn-primary', style:'margin-top:8px', onclick: () => { closeModal(); openNewTask(d.id); } }, '+ Задача'));
  }
  renderTasks();
  const paneTasks = el('div', { class:'chat-pane', 'data-pane':'tasks' }, [el('div', { class:'section-title', style:'padding:12px 14px 6px' }, 'Задачи'), tasksList]);

  // Вкладки строятся динамически по правам: разделы Документы/Отгрузка/Задачи
  // показываются только при доступе к соответствующему модулю. Скрытые вкладки
  // не появляются ни как кнопка, ни как панель с данными.
  const tabDefs = [
    ['items', 'Товары', paneItems, true],
    ['whatsapp', 'WhatsApp', paneWhats, true],
    ['comments', 'Комментарии', paneComments, true],
    ['docs', 'Документы', paneDocs, can('see-module', 'invoices')],
    ['shipment', 'Отгрузка', paneShip, can('see-module', 'shipments')],
    ['tasks', 'Задачи', paneTasks, can('see-module', 'tasks')],
    ['history', 'История', paneHist, true],
  ].filter(t => t[3]);
  const tabPanes = tabDefs.map(t => t[2]);

  const tabs = el('div', { class:'chat-tabs' });
  function switchTab(key) {
    if (!tabDefs.some(t => t[0] === key)) return; // нет доступа к вкладке — игнорируем
    tabs.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === key));
    tabPanes.forEach(p => p.classList.toggle('active', p.getAttribute('data-pane') === key));
  }
  tabDefs.forEach(([k, label]) =>
    tabs.append(el('div', { class:'chat-tab' + (k === 'whatsapp' ? ' active' : ''), 'data-tab':k, onclick: () => switchTab(k) }, label)));
  if (opts && opts.tab) switchTab(opts.tab); // открыть на нужной вкладке (если доступна)

  const right = el('div', { class:'deal-right' }, [tabs, ...tabPanes]);

  // ----- Чат (Green API) -----
  function bubble(mm) {
    const out = mm.direction === 'out';
    const mark = out ? (mm.status === 'sent' ? ' ✓' : (mm.status === 'error' ? ' ✕' : '')) : '';
    return el('div', { class:'msg ' + (out ? 'out' : 'in') }, [el('div', {}, mm.text || ''), el('div', { class:'time' }, String(mm.created_at || '').slice(11, 16) + mark)]);
  }
  function exampleChat() {
    chatBody.append(
      el('div', { class:'chat-date' }, 'Сегодня'),
      el('div', { class:'msg in' }, [
        el('div', { class:'msg-file' }, [
          el('span', { class:'fi' }, '📄'),
          el('div', {}, [el('div', { class:'fn' }, 'Счёт.pdf'), el('div', { class:'fd' }, 'PDF · 142 КБ · коммерческое предложение')]),
        ]),
        el('div', { class:'time' }, '09:14'),
      ]),
      el('div', { class:'msg in' }, [el('div', {}, 'Здравствуйте! Получили счёт, спасибо.'), el('div', { class:'time' }, '09:20')]),
      el('div', { class:'msg out' }, [el('div', {}, 'Добрый день! Готовы отгрузить на этой неделе.'), el('div', { class:'time' }, '09:25 ✓')]),
      el('div', { class:'msg-sys' }, ['✓ Клиент согласовал условия сделки · 09:40']),
    );
  }
  function renderChat() {
    chatBody.innerHTML = '';
    window.__API__.apiFetch('greenapi/messages?dealId=' + encodeURIComponent(d.id)).then(rows => {
      chatBody.innerHTML = '';
      if (!rows || !rows.length) { exampleChat(); return; }
      let lastDate = '';
      rows.slice().reverse().forEach(mm => {
        const day = String(mm.created_at || '').slice(0, 10);
        if (day && day !== lastDate) { chatBody.append(el('div', { class:'chat-date' }, fmtDate(day))); lastDate = day; }
        chatBody.append(bubble(mm));
      });
      chatBody.scrollTop = chatBody.scrollHeight;
    }).catch(() => { chatBody.innerHTML = ''; exampleChat(); });
  }
  async function sendChat() {
    const text = chatInputEl.value.trim();
    if (!text) return;
    chatInputEl.value = '';
    try { await window.__API__.apiFetch('greenapi/send', { method:'POST', body:{ dealId: d.id, text } }); renderChat(); }
    catch (e) { toast('WhatsApp: ' + ((e && e.message) || e), 'error'); chatInputEl.value = text; }
  }
  chatInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });
  renderChat();

  // Кнопки оплаты в карточке сделки убраны — оплата меняется только в разделе «Документы».

  openModal({
    wide: true,
    title: d.title,
    body: el('div', { class:'deal-modal' }, [funnel, el('div', { class:'deal-split' }, [left, right])]),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Закрыть'),
      canEdit ? el('button', { class:'btn btn-primary', onclick: async () => {
        d.stage = chosenStage;
        d.title = titleI.value.trim() || d.title;
        d.address = addressI.value;
        d.manager = mgrSel.value;
        d.comments = commentsTA.value;
        d.amount = baseAmount + lineItemsSum(); // итог = ручная база + сумма позиций
        try {
          const payload = { ...window.__API__.toApi.deal(d) };
          if (d.lineItems && d.lineItems.length) payload.lineItems = window.__API__.toApi.dealItems(d.lineItems);
          const saved = await window.__API__.apiFetch('deals/' + d.id, { method:'PUT', body: payload });
          Object.assign(d, window.__API__.map.deal(saved));
          if (/отгруж/i.test((stageById(d.stage) || {}).label || '')) toast('Этап «Отгружено»: товар списан со склада', 'info');
          closeModal(); toast('Сделка сохранена', 'success'); navigate('deals');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Сохранить') : null,
    ],
  });
}

// WhatsApp по сделке через Green API: отправка + история сообщений
function openWhatsApp(deal) {
  const cl = clientById(deal.client);
  const phone = (cl && cl.phone) || '';
  const status = el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Проверка Green API…');
  const ta = el('textarea', { rows:4, style:'width:100%' });
  ta.value = `Здравствуйте${cl && cl.contact ? ', ' + cl.contact : ''}! Пишем по сделке «${deal.title}».`;
  const histHost = el('div', { style:'margin-top:12px' }, el('div', { class:'muted', style:'font-size:12px' }, 'История сообщений…'));

  function loadHistory() {
    window.__API__.apiFetch('greenapi/messages?dealId=' + encodeURIComponent(deal.id)).then(rows => {
      histHost.innerHTML = '';
      if (!rows || !rows.length) { histHost.append(el('div', { class:'muted', style:'font-size:12px' }, 'Сообщений пока нет')); return; }
      histHost.append(el('div', { style:'font-weight:600;font-size:12px;margin-bottom:6px' }, 'Последние сообщения'));
      rows.forEach(m => histHost.append(el('div', { style:'padding:6px 8px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:6px' }, [
        el('div', { style:'font-size:13px' }, m.text),
        el('div', { class:'muted', style:'font-size:10.5px;margin-top:2px' }, `${m.direction === 'out' ? '→ ' : '← '}${String(m.created_at || '').slice(0, 16)} · ${m.status === 'sent' ? 'отправлено' : m.status}`),
      ])));
    }).catch(() => { histHost.innerHTML = ''; });
  }

  const sendBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    const text = ta.value.trim();
    if (!text) { toast('Введите сообщение', 'warn'); return; }
    sendBtn.disabled = true; const o = sendBtn.textContent; sendBtn.textContent = 'Отправка…';
    try {
      await window.__API__.apiFetch('greenapi/send', { method:'POST', body: { dealId: deal.id, text } });
      toast('Сообщение отправлено', 'success'); ta.value = ''; loadHistory();
    } catch (e) { toast('Ошибка: ' + ((e && e.message) || e), 'error'); }
    sendBtn.disabled = false; sendBtn.textContent = o;
  } }, 'Отправить');

  window.__API__.apiFetch('greenapi/status').then(s => {
    if (s && s.configured) {
      status.textContent = `Получатель: ${cl ? cl.name : '—'} · ${phone || 'номер не указан'}`;
    } else {
      status.innerHTML = '';
      status.append(el('div', { class:'pill pill-warn', style:'font-size:11px' }, 'Green API не настроен — задайте секреты GREENAPI_INSTANCE и GREENAPI_TOKEN'));
      sendBtn.disabled = true;
    }
  }).catch(() => {});

  loadHistory();

  openModal({
    title: 'WhatsApp — ' + (cl ? cl.name : 'клиент'),
    body: el('div', {}, [
      status,
      el('div', { class:'form-row' }, [el('label', {}, 'Сообщение'), ta]),
      histHost,
    ]),
    foot: [el('button', { class:'btn', onclick: closeModal }, 'Закрыть'), sendBtn],
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
        ensureActivePipeline();
        const firstStage = pipelineStages(DEALS_PIPELINE)[0];
        const nd = { no: '2026-0' + num, client: clientSel.value, manager: mgrSel.value, stage: firstStage ? firstStage.id : 'new', amount: Number(amountI.value) || 0, items: 0, created: today, target: today, title: titleI.value.trim() };
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
      el('button', { class: 'btn btn-primary', onclick: openNewClient }, '+ Клиент'),
    ]),
  ]));

  // Локальная фильтрация (все фильтры комбинируются, обновление без перезагрузки)
  const filterState = { q: '', type: '', city: '', manager: '', from: '', to: '' };
  const cities = Array.from(new Set(state.clients.map(c => c.city).filter(Boolean))).sort();
  const managers = state.users.filter(u => u.active !== false);
  const searchI = el('input', { placeholder:'Поиск клиента или БИН…', oninput: e => { filterState.q = e.target.value.toLowerCase(); applyFilter(); } });
  const typeS = el('select', { onchange: e => { filterState.type = e.target.value; applyFilter(); } },
    [el('option', { value:'' }, 'Все типы'), el('option', { value:'opt' }, 'Опт'), el('option', { value:'rozn' }, 'Розница'), el('option', { value:'dilr' }, 'Дилер')]);
  const cityS = el('select', { onchange: e => { filterState.city = e.target.value; applyFilter(); } },
    [el('option', { value:'' }, 'Все города')].concat(cities.map(c => el('option', { value: c }, c))));
  const mgrS = el('select', { onchange: e => { filterState.manager = e.target.value; applyFilter(); } },
    [el('option', { value:'' }, 'Все менеджеры')].concat(managers.map(u => el('option', { value: u.id }, u.name))));
  const fromI = el('input', { type:'date', onchange: e => { filterState.from = e.target.value; applyFilter(); } });
  const toI = el('input', { type:'date', onchange: e => { filterState.to = e.target.value; applyFilter(); } });
  const drawer = buildFilterDrawer({
    groups: [
      filterGroup('Тип', typeS),
      filterGroup('Город', cityS),
      filterGroup('Менеджер', mgrS),
      filterGroup('Последняя сделка', el('div', { class:'row2' }, [fromI, toI])),
    ],
    onReset: () => { Object.assign(filterState, { type:'', city:'', manager:'', from:'', to:'' }); typeS.value=''; cityS.value=''; mgrS.value=''; fromI.value=''; toI.value=''; applyFilter(); },
    countActive: () => ['type','city','manager','from','to'].filter(k => filterState[k]).length,
  });
  // Пагинация (клиентская — по отфильтрованному списку)
  let page = 1; const PAGE_SIZE = 50;
  function applyFilter() { page = 1; refresh(); }

  // Массовое редактирование: выбор клиентов
  const selected = new Set();
  let visibleNow = state.clients;
  const selAll = el('input', { type:'checkbox', title:'Выбрать всех (по фильтру)' });
  const bulkCount = el('span', { class:'strong' }, '');
  const isDir = currentUser && currentUser.roleKey === 'director';
  const delBtn = isDir ? el('button', { class:'btn btn-sm btn-danger', onclick: () => bulkDeleteClients() }, '🗑 Удалить') : null;
  const bulkBar = el('div', { class:'bulk-bar', style:'display:none' }, [
    bulkCount,
    el('button', { class:'btn btn-sm btn-primary', onclick: () => openClientBulkEdit([...selected]) }, 'Массовое редактирование'),
    delBtn,
    el('button', { class:'btn btn-sm', onclick: () => { selected.clear(); selAll.checked = false; refresh(); } }, 'Снять выбор'),
  ]);
  function refreshBulk() { bulkCount.textContent = `Выбрано: ${selected.size}`; bulkBar.style.display = selected.size ? '' : 'none'; }
  async function bulkDeleteClients() {
    const ids = [...selected]; if (!ids.length) return;
    if (!(await confirmModal({ title:'Подтверждение удаления', message:'Вы уверены, что хотите удалить выбранные элементы? Они будут перемещены в архив на 30 дней.', confirmText:'Удалить', cancelText:'Отмена', danger:true }))) return;
    if (delBtn) delBtn.disabled = true;
    try {
      for (const id of ids) {
        await window.__API__.apiFetch('clients/' + id, { method:'DELETE' });
        const idx = state.clients.findIndex(x => x.id === id); if (idx >= 0) state.clients.splice(idx, 1);
      }
      toast(`Перемещено в архив: ${ids.length}`, 'success');
      selected.clear(); navigate('clients');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); if (delBtn) delBtn.disabled = false; }
  }
  selAll.onchange = () => {
    visibleNow.forEach(c => { if (selAll.checked) selected.add(c.id); else selected.delete(c.id); });
    refresh();
  };

  const tw = el('div', { class: 'table-wrap' });
  // «Фильтры» — справа от поиска; Импорт/Экспорт прижаты к правому краю
  tw.append(el('div', { class: 'table-toolbar' }, [
    searchI,
    drawer.btn,
    el('div', { style:'display:flex;gap:8px;margin-left:auto' }, [
      el('button', { class: 'btn', onclick: () => openImport('clients') }, '📥 Импорт'),
      el('button', { class: 'btn', onclick: () => exportClientsCSV() }, [svgIconEl('download', 16), ' Экспорт']),
    ]),
  ]));
  tw.append(bulkBar);

  function refresh() {
    drawer.refreshBadge();
    const visible = state.clients.filter(c => {
      if (filterState.q && !(c.name+c.bin+c.contact).toLowerCase().includes(filterState.q)) return false;
      if (filterState.type && c.type !== filterState.type) return false;
      if (filterState.city && c.city !== filterState.city) return false;
      if (filterState.manager && c.manager !== filterState.manager) return false;
      if (filterState.from || filterState.to) {
        const d = String(c.lastDeal || '').slice(0, 10);
        if (!d) return false;
        if (filterState.from && d < filterState.from) return false;
        if (filterState.to && d > filterState.to) return false;
      }
      return true;
    });
    visibleNow = visible;
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const tb = tw.querySelector('tbody');
    if (tb) tb.replaceWith(buildTbody(pageItems));
    renderPager(visible.length, pages);
    selAll.checked = visible.length > 0 && visible.every(x => selected.has(x.id));
    refreshBulk();
  }
  function renderPager(total, pages) {
    pager.innerHTML = '';
    if (!total) return;
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(total, page * PAGE_SIZE);
    pager.append(
      el('div', { class:'muted', style:'font-size:12px' }, `Показано ${from}–${to} из ${total} · стр. ${page} из ${pages}`),
      el('div', { class:'row', style:'gap:6px' }, [
        el('button', { class:'btn btn-sm', disabled: page <= 1 ? 'disabled' : null, onclick: () => { if (page > 1) { page--; refresh(); } } }, '← Назад'),
        el('button', { class:'btn btn-sm', disabled: page >= pages ? 'disabled' : null, onclick: () => { if (page < pages) { page++; refresh(); } } }, 'Вперёд →'),
      ]),
    );
  }
  function buildTbody(list) {
    return el('tbody', {}, list.map(c => {
      const m = userById(c.manager);
      const ct = CLIENT_TYPES[c.type] || { label: '—', color: '#999' };
      const cb = el('input', { type:'checkbox', checked: selected.has(c.id) ? 'checked' : null, onclick: (e) => e.stopPropagation(),
        onchange: () => { if (cb.checked) selected.add(c.id); else selected.delete(c.id); selAll.checked = visibleNow.length > 0 && visibleNow.every(x => selected.has(x.id)); refreshBulk(); } });
      return el('tr', { onclick: () => openClientDetail(c.id) }, [
        el('td', { style:'text-align:center', onclick: (e) => e.stopPropagation() }, cb),
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
    el('th', { style:'width:34px;text-align:center' }, selAll),
    el('th', {}, 'Клиент'),
    el('th', {}, 'БИН'),
    el('th', {}, 'Тип'),
    el('th', {}, 'Город'),
    el('th', {}, 'Менеджер'),
    el('th', { class: 'num' }, 'LTV'),
    el('th', { class: 'num' }, 'Баланс'),
    el('th', {}, 'Последняя сделка'),
  ])));
  t.append(buildTbody([]));

  tw.append(t);
  wrap.append(tw);
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' });
  wrap.append(pager);
  wrap.append(drawer.backdrop, drawer.drawer);
  refresh(); // первичная отрисовка с пагинацией
  return wrap;
};

// Массовое редактирование выбранных клиентов: заполните нужные поля (пустые — не меняются)
function openClientBulkEdit(ids) {
  const total = ids.length;
  if (!total) { toast('Не выбрано ни одного клиента', 'warn'); return; }
  const mgrSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), ...state.users.filter(u => u.active !== false).map(u => el('option', { value: u.id }, u.name))]);
  const nameI = el('input', { placeholder:'Оставьте пустым, чтобы не менять' });
  const sumI = el('input', { type:'number', placeholder:'Оставьте пустым, чтобы не менять' });
  const addrI = el('input', { placeholder:'Оставьте пустым, чтобы не менять' });

  const applyBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    const body = {};
    if (mgrSel.value) body.manager_id = mgrSel.value;
    if (nameI.value.trim()) body.name = nameI.value.trim();
    if (sumI.value !== '') body.ltv = Number(sumI.value) || 0;
    if (addrI.value.trim()) body.address = addrI.value.trim();
    if (!Object.keys(body).length) { toast('Заполните хотя бы одно поле', 'warn'); return; }
    applyBtn.disabled = true;
    try {
      for (let i = 0; i < ids.length; i += 8) { // батчами
        await Promise.all(ids.slice(i, i + 8).map(id => window.__API__.apiFetch('clients/' + id, { method:'PUT', body }).then(() => {
          const c = byId(state.clients, id);
          if (c) {
            if ('manager_id' in body) c.manager = body.manager_id;
            if ('name' in body) c.name = body.name;
            if ('ltv' in body) c.ltv = body.ltv;
            if ('address' in body) c.address = body.address;
          }
        })));
      }
      closeModal(); toast(`Изменено клиентов: ${ids.length}`, 'success'); navigate('clients');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); applyBtn.disabled = false; }
  } }, `Применить к ${total}`);

  openModal({
    title: `Массовое редактирование · ${total} ${plural(total, 'клиент', 'клиента', 'клиентов')}`,
    body: el('div', {}, [
      el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Заполните только те поля, которые нужно изменить. Пустые поля остаются без изменений.'),
      el('div', { class:'form-row' }, [el('label', {}, 'Менеджер'), mgrSel]),
      el('div', { class:'form-row' }, [el('label', {}, 'Название'), nameI]),
      el('div', { class:'form-row' }, [el('label', {}, 'Сумма (LTV)'), sumI]),
      el('div', { class:'form-row' }, [el('label', {}, 'Адрес'), addrI]),
    ]),
    foot: [el('button', { class:'btn', onclick: closeModal }, 'Отмена'), applyBtn],
  });
}

async function openClientDetail(id) {
  let c = byId(state.clients, id);
  if (!c) {
    // прямая ссылка #clients/{id}: клиента нет в памяти — тянем из БД
    try {
      const raw = await window.__API__.apiFetch('clients/' + encodeURIComponent(id));
      c = window.__API__.map.client(raw);
      if (!c || !c.id) throw new Error('not found');
      state.clients.push(c);
    } catch (e) { showNotFound('clients', id); return; }
  }
  setEntityHash('clients', c.id); // уникальный URL карточки
  const canEdit = can('edit-client', c);

  // ----- Левая панель: редактируемые поля клиента -----
  const fName = fInput('Наименование', c.name || '');
  const fType = fSelect('Тип клиента', Object.keys(CLIENT_TYPES).map(k => ({ value: k, label: CLIENT_TYPES[k].label })), c.type);
  const fBin = fInput('БИН/ИИН', c.bin || '');
  const fContact = fInput('Контактное лицо', c.contact || '');
  const fPhone = fInput('Телефон', c.phone || '');
  const fEmail = fInput('Email', c.email || '', { type: 'email' });
  const fCity = fInput('Город', c.city || '');
  const fAddr = fInput('Адрес', c.address || '');
  const fMgr = fSelect('Менеджер', state.users.filter(u => u.active !== false).map(u => ({ value: u.id, label: u.name })), c.manager);
  const fLtv = fInput('LTV, ₸', c.ltv != null ? c.ltv : '', { type: 'number' });
  const fBal = fInput('Баланс, ₸', c.balance != null ? c.balance : '', { type: 'number' });
  const fields = [fName, fType, fBin, fContact, fPhone, fEmail, fCity, fAddr, fMgr, fLtv, fBal];
  if (!canEdit) fields.forEach(f => f.row.querySelectorAll('input,select').forEach(i => i.disabled = true));
  const left = el('div', { class:'deal-left' }, [el('div', { class:'section-title' }, 'Информация о клиенте'), ...fields.map(f => f.row)]);

  // ----- Правая панель: связанные сделки (живой список из state.deals) -----
  const dealsHost = el('div', { style:'padding:12px 14px;overflow-y:auto;flex:1' });
  function renderDeals() {
    const dealsOf = state.deals.filter(d => d.client === c.id)
      .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
    dealsHost.innerHTML = '';
    dealsHost.append(el('div', { class:'section-title' }, `Сделки клиента (${dealsOf.length})`));
    if (!dealsOf.length) { dealsHost.append(el('div', { class:'muted', style:'padding:16px;text-align:center' }, 'Сделок ещё нет')); return; }
    const tbl = el('table', { class:'data' });
    tbl.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Сделка'), el('th', {}, 'Этап'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Дата')])));
    tbl.append(el('tbody', {}, dealsOf.map(d => {
      const s = stageById(d.stage);
      return el('tr', { style:'cursor:pointer', onclick: () => { closeModal(); openDealDetail(d.id); } }, [
        el('td', { class:'strong' }, d.title),
        el('td', {}, el('span', { class:'pill', style:`background:${s.color}22;color:${s.color}` }, s.label)),
        el('td', { class:'num strong' }, fmtMoneyK(d.amount)),
        el('td', { class:'muted' }, d.created ? fmtDate(d.created) : '—'),
      ]);
    })));
    dealsHost.append(tbl);
  }
  renderDeals();

  // ----- Документы: счета клиента (синхронно с разделом «Документы») -----
  const docsHost = el('div', { style:'padding:12px 14px;overflow-y:auto;flex:1;display:none' });
  function renderDocs() {
    const invs = state.invoices.filter(iv => iv.client === c.id)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    docsHost.innerHTML = '';
    docsHost.append(el('div', { class:'section-title' }, `Счета клиента (${invs.length})`));
    if (!invs.length) { docsHost.append(el('div', { class:'muted', style:'padding:16px;text-align:center' }, 'Счетов ещё нет')); return; }
    const stMap = { paid:['pill-success','Оплачено'], pending:['pill-warn','Ожидает'], overdue:['pill-danger','Просрочка'] };
    const tbl = el('table', { class:'data' });
    tbl.append(el('thead', {}, el('tr', {}, [el('th', {}, '№ счёта'), el('th', {}, 'Дата'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Статус')])));
    tbl.append(el('tbody', {}, invs.map(iv => {
      const sp = stMap[iv.status] || ['pill-muted', iv.status || '—'];
      return el('tr', { style:'cursor:pointer', onclick: () => { closeModal(); openInvoiceDetail(iv.id); } }, [
        el('td', { class:'strong' }, iv.no),
        el('td', { class:'muted' }, iv.date ? fmtDate(iv.date) : '—'),
        el('td', { class:'num strong' }, fmtMoneyK(iv.amount)),
        el('td', {}, el('span', { class:'pill ' + sp[0] }, sp[1])),
      ]);
    })));
    docsHost.append(tbl);
  }
  renderDocs();

  const cTabs = el('div', { class:'chat-tabs' });
  function cSwitch(key) {
    cTabs.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === key));
    dealsHost.style.display = key === 'deals' ? '' : 'none';
    docsHost.style.display = key === 'docs' ? '' : 'none';
  }
  [['deals','Сделки'],['docs','Документы']].forEach(([k, label]) =>
    cTabs.append(el('div', { class:'chat-tab' + (k === 'deals' ? ' active' : ''), 'data-tab':k, onclick: () => cSwitch(k) }, label)));
  const right = el('div', { class:'deal-right' }, [cTabs, dealsHost, docsHost]);

  async function saveClient(btn) {
    if (btn) btn.disabled = true;
    const upd = {
      id: c.id, name: fName.get().trim() || c.name, type: fType.get(), bin: fBin.get(), contact: fContact.get(),
      phone: fPhone.get(), email: fEmail.get(), city: fCity.get(), address: fAddr.get(), manager: fMgr.get(),
      ltv: Number(fLtv.get()) || 0, balance: Number(fBal.get()) || 0,
    };
    try {
      const saved = await window.__API__.apiFetch('clients/' + c.id, { method:'PUT', body: window.__API__.toApi.client(upd) });
      Object.assign(c, window.__API__.map.client(saved)); // c — ссылка из state.clients → синхронно во всех разделах
      const titleEl = document.querySelector('#modal-title'); if (titleEl) titleEl.textContent = c.name;
      toast('Клиент сохранён', 'success');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    finally { if (btn) btn.disabled = false; }
  }

  openModal({
    wide: true,
    title: c.name,
    body: el('div', { class:'deal-modal' }, [el('div', { class:'deal-split' }, [left, right])]),
    foot: [
      el('button', { class:'btn', onclick: closeModal }, 'Закрыть'),
      el('button', { class:'btn', onclick: () => { closeModal(); openNewDeal(); toast('Подставлю клиента в новую сделку', 'info'); } }, '+ Сделка'),
      (currentUser.roleKey === 'director') ? el('button', { class:'btn btn-danger', onclick: async () => {
        if (!(await confirmModal({ title:'Удаление клиента', message:`Удалить клиента «${c.name}»? Он переместится в архив на 30 дней, затем удалится навсегда.`, confirmText:'Удалить', danger:true }))) return;
        try {
          await window.__API__.apiFetch('clients/' + c.id, { method:'DELETE' });
          const i = state.clients.findIndex(x => x.id === c.id); if (i >= 0) state.clients.splice(i, 1);
          closeModal(); toast('Клиент перемещён в архив', 'success'); navigate('clients');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      } }, 'Удалить') : null,
      canEdit ? el('button', { class:'btn btn-primary', onclick: (e) => saveClient(e.currentTarget) }, 'Сохранить') : null,
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

  const q = { q: '', category: '', brand: '', sort: '', stockMin: '', stockMax: '', costMin: '', costMax: '', page: 1, limit: 50, total: 0 };
  const selected = new Set(); // выбранные товары для массового редактирования

  // Категории (серверный подсчёт)
  wrap.append(el('div', { style:'font-weight:600;margin:8px 0 12px;font-size:14px' }, 'Категории'));
  const tilesHost = el('div', { class: 'cat-grid' });
  wrap.append(tilesHost);

  // Тулбар: поиск + бренд + сортировка по цене
  const searchI = el('input', { placeholder:'Поиск по артикулу или названию…' });
  const brandSel = el('select', {},
    [el('option', { value:'' }, 'Все бренды'), el('option', { value:'EKF' }, 'EKF'), el('option', { value:'KazКабель' }, 'KazКабель'), el('option', { value:'WAGO' }, 'WAGO'), el('option', { value:'КВТ' }, 'КВТ')]);
  const sortSel = el('select', {}, [
    el('option', { value:'' }, 'Без сортировки'),
    el('option', { value:'price_asc' }, 'Цена: по возрастанию'),
    el('option', { value:'price_desc' }, 'Цена: по убыванию'),
  ]);
  sortSel.onchange = (e) => { q.sort = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); };
  const stockMinI = el('input', { type:'number', placeholder:'от', onchange: e => { q.stockMin = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); } });
  const stockMaxI = el('input', { type:'number', placeholder:'до', onchange: e => { q.stockMax = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); } });
  const costMinI = el('input', { type:'number', placeholder:'от', onchange: e => { q.costMin = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); } });
  const costMaxI = el('input', { type:'number', placeholder:'до', onchange: e => { q.costMax = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); } });

  // Панель массового редактирования
  const bulkCount = el('span', { class:'strong' }, '');
  const bulkBar = el('div', { class:'bulk-bar', style:'display:none' }, [
    bulkCount,
    el('button', { class:'btn btn-sm btn-primary', onclick: () => openProductBulkEdit([...selected], () => { selected.clear(); loadProducts(); }) }, 'Массовое редактирование'),
    el('button', { class:'btn btn-sm', onclick: () => { selected.clear(); loadProducts(); } }, 'Снять выбор'),
  ]);
  function refreshBulk() { bulkCount.textContent = `Выбрано: ${selected.size}`; bulkBar.style.display = selected.size ? '' : 'none'; }

  const drawer = buildFilterDrawer({
    groups: [
      filterGroup('Бренд', brandSel),
      filterGroup('Сортировка', sortSel),
      filterGroup('Остаток, шт', el('div', { class:'row2' }, [stockMinI, stockMaxI])),
      filterGroup('Закупочная цена, ₸', el('div', { class:'row2' }, [costMinI, costMaxI])),
    ],
    onReset: () => {
      Object.assign(q, { brand:'', sort:'', stockMin:'', stockMax:'', costMin:'', costMax:'', page:1 });
      brandSel.value=''; sortSel.value=''; stockMinI.value=''; stockMaxI.value=''; costMinI.value=''; costMaxI.value='';
      loadProducts();
    },
    countActive: () => [q.brand, q.sort].filter(Boolean).length + [q.stockMin, q.stockMax, q.costMin, q.costMax].filter(v => v !== '' && v != null).length,
  });
  const tw = el('div', { class: 'table-wrap', style:'margin-top:24px' });
  tw.append(el('div', { class: 'table-toolbar' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  tw.append(drawer.backdrop, drawer.drawer);
  tw.append(bulkBar);
  const tableHost = el('div');
  tw.append(tableHost);
  wrap.append(tw);
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' });
  wrap.append(pager);

  let deb;
  searchI.oninput = (e) => { clearTimeout(deb); const v = e.target.value; deb = setTimeout(() => { q.q = v; q.page = 1; loadProducts(); }, 300); };
  brandSel.onchange = (e) => { q.brand = e.target.value; q.page = 1; loadProducts(); drawer.refreshBadge(); };

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
      let qs = `q=${encodeURIComponent(q.q)}&category=${encodeURIComponent(q.category)}&brand=${encodeURIComponent(q.brand)}&sort=${encodeURIComponent(q.sort)}&page=${q.page}&limit=${q.limit}`;
      if (q.stockMin !== '') qs += '&stock_min=' + encodeURIComponent(q.stockMin);
      if (q.stockMax !== '') qs += '&stock_max=' + encodeURIComponent(q.stockMax);
      if (q.costMin !== '') qs += '&cost_min=' + encodeURIComponent(q.costMin);
      if (q.costMax !== '') qs += '&cost_max=' + encodeURIComponent(q.costMax);
      const r = await window.__API__.apiFetch('products?' + qs);
      q.total = r.total || 0;
      sub.textContent = `${q.total} позиций` + (q.category ? ' в категории' : '');
      const pageProducts = (r.data || []).map(row => window.__API__.map.product(row));
      const rowChecks = [];
      const selAll = el('input', { type:'checkbox', title:'Выбрать товары на странице' });
      const syncSelAll = () => { selAll.checked = pageProducts.length > 0 && pageProducts.every(p => selected.has(p.id)); };
      selAll.onchange = () => { pageProducts.forEach((p, i) => { if (selAll.checked) selected.add(p.id); else selected.delete(p.id); if (rowChecks[i]) rowChecks[i].checked = selAll.checked; }); refreshBulk(); };
      const t = el('table', { class:'data' });
      t.append(el('thead', {}, el('tr', {}, [
        el('th', { style:'width:34px;text-align:center' }, selAll),
        el('th', {}, 'Артикул'), el('th', {}, 'Наименование'), el('th', {}, 'Бренд'),
        el('th', { class:'num' }, 'Закуп'), el('th', { class:'num' }, 'Опт'), el('th', { class:'num' }, 'Розница'), el('th', {}, 'Остаток'),
      ])));
      const rows = pageProducts.map((p, i) => {
        const cb = el('input', { type:'checkbox', checked: selected.has(p.id) ? 'checked' : null, onclick: (e) => e.stopPropagation(),
          onchange: () => { if (cb.checked) selected.add(p.id); else selected.delete(p.id); syncSelAll(); refreshBulk(); } });
        rowChecks[i] = cb;
        return el('tr', { onclick: () => openProductDetail(p) }, [
          el('td', { style:'text-align:center', onclick: (e) => e.stopPropagation() }, cb),
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
      syncSelAll();
      t.append(el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: 8, class:'muted', style:'text-align:center;padding:24px' }, 'Ничего не найдено'))]));
      tableHost.innerHTML = ''; tableHost.append(t);
      renderPager(); refreshBulk();
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

// Массовое редактирование выбранных товаров: заполните нужные поля (пустые — не меняются)
function openProductBulkEdit(ids, onDone) {
  const total = ids.length;
  if (!total) { toast('Не выбрано ни одного товара', 'warn'); return; }
  const nameI = el('input', { placeholder:'Оставьте пустым, чтобы не менять' });
  const priceI = el('input', { type:'number', min:'0', placeholder:'Оставьте пустым, чтобы не менять' });
  const stockI = el('input', { type:'number', min:'0', placeholder:'Оставьте пустым, чтобы не менять' });

  const applyBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    const body = {};
    if (nameI.value.trim()) body.name = nameI.value.trim();
    if (priceI.value !== '') body.price_wholesale = Number(priceI.value) || 0;
    const setStock = stockI.value !== '';
    if (!Object.keys(body).length && !setStock) { toast('Заполните хотя бы одно поле', 'warn'); return; }
    applyBtn.disabled = true;
    try {
      for (let i = 0; i < ids.length; i += 6) { // батчами
        await Promise.all(ids.slice(i, i + 6).map(async (id) => {
          if (Object.keys(body).length) await window.__API__.apiFetch('products/' + id, { method:'PUT', body });
          if (setStock) await window.__API__.apiFetch('products/' + id + '/stock', { method:'PUT', body: { stock: Number(stockI.value) || 0 } });
        }));
      }
      closeModal(); toast(`Изменено товаров: ${ids.length}`, 'success'); if (onDone) onDone();
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); applyBtn.disabled = false; }
  } }, `Применить к ${total}`);

  openModal({
    title: `Массовое редактирование · ${total} ${plural(total, 'товар', 'товара', 'товаров')}`,
    body: el('div', {}, [
      el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Заполните только те поля, которые нужно изменить. Пустые поля остаются без изменений.'),
      el('div', { class:'form-row' }, [el('label', {}, 'Название'), nameI]),
      el('div', { class:'form-row' }, [el('label', {}, 'Цена (опт), ₸'), priceI]),
      el('div', { class:'form-row' }, [el('label', {}, 'Остаток на складе'), stockI]),
    ]),
    foot: [el('button', { class:'btn', onclick: closeModal }, 'Отмена'), applyBtn],
  });
}

// Документ прихода/расхода со статусами (черновик → проведён → отменён)
async function openStockDoc(type, docId, onDone) {
  let doc = null;
  if (docId) {
    try { doc = await window.__API__.apiFetch('stock-docs/' + docId); } catch (e) { toast('Документ не найден', 'error'); return; }
    type = doc.type;
  }
  const isIn = type === 'receipt';
  const status = doc ? doc.status : 'draft';
  const editable = status === 'draft';
  const items = doc ? (doc.items || []).map(it => ({ ...it })) : [];

  const partyI = el('input', { value: doc ? (doc.counterparty || '') : '', placeholder: isIn ? 'Поставщик' : 'Получатель / причина' });
  const dateI = el('input', { type:'date', value: doc ? String(doc.date || '').slice(0, 10) : new Date().toISOString().slice(0, 10) });
  const noteI = el('input', { value: doc ? (doc.note || '') : '', placeholder:'Примечание' });
  if (!editable) [partyI, dateI, noteI].forEach(i => i.disabled = true);

  const itemsHost = el('div', { style:'margin-top:6px' });
  function renderItems() {
    itemsHost.innerHTML = '';
    const t = el('table', { class:'data' });
    t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Товар'), el('th', { class:'num', style:'width:90px' }, 'Кол-во'), editable ? el('th', { style:'width:26px' }, '') : null])));
    const tb = el('tbody');
    if (!items.length) tb.append(el('tr', {}, el('td', { colspan: editable ? 3 : 2, class:'muted', style:'text-align:center;padding:12px' }, 'Позиций нет')));
    else items.forEach((it, idx) => tb.append(el('tr', {}, [
      el('td', {}, [el('div', { class:'strong' }, it.product_name || '—'), el('div', { class:'muted', style:'font-size:11px' }, it.product_sku || '')]),
      el('td', { class:'num' }, editable ? el('input', { class:'qty', type:'number', min:'1', value: it.qty, oninput: (e) => { it.qty = Math.max(1, +e.target.value || 1); } }) : String(it.qty)),
      editable ? el('td', {}, el('button', { class:'x-btn', title:'Удалить', onclick: () => { items.splice(idx, 1); renderItems(); } }, '×')) : null,
    ])));
    t.append(tb); itemsHost.append(t);
  }
  renderItems();

  const pickerHost = el('div');
  if (editable) {
    const search = el('input', { placeholder:'Добавить товар: поиск по артикулу/названию…', style:'width:100%' });
    const list = el('div', { class:'product-picker', style:'margin-top:6px' });
    let seq = 0;
    async function fill(q = '') {
      const my = ++seq; const ql = q.trim();
      list.innerHTML = ''; list.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Загрузка…'));
      let rows; try { const resp = await window.__API__.apiFetch('products?limit=100' + (ql ? '&q=' + encodeURIComponent(ql) : '')); rows = (resp.data || []).map(window.__API__.map.product); } catch (e) { rows = []; }
      if (my !== seq) return;
      list.innerHTML = '';
      rows.forEach(p => list.append(el('div', { class:'pp-item', onclick: () => {
        const ex = items.find(x => x.product_id === p.id); if (ex) ex.qty += 1; else items.push({ product_id: p.id, product_name: p.name, product_sku: p.sku, qty: 1 });
        renderItems();
      } }, [el('div', {}, [el('div', {}, p.name), el('div', { class:'pp-sku' }, p.sku)]), el('span', { class:'pp-price' }, 'ост. ' + p.stock)])));
      if (!rows.length) list.append(el('div', { class:'pp-item muted', style:'cursor:default;justify-content:center' }, 'Ничего не найдено'));
    }
    let dt; search.oninput = (e) => { const v = e.target.value; clearTimeout(dt); dt = setTimeout(() => fill(v), 250); };
    fill(); // показываем все товары сразу
    pickerHost.append(search, list);
  }

  async function saveDraft() {
    const body = { type, counterparty: partyI.value.trim(), date: dateI.value, note: noteI.value.trim(), items: items.map(it => ({ product_id: it.product_id, qty: it.qty })) };
    doc = doc ? await window.__API__.apiFetch('stock-docs/' + doc.id, { method:'PUT', body }) : await window.__API__.apiFetch('stock-docs', { method:'POST', body });
    return doc;
  }

  const foot = [el('button', { class:'btn', onclick: closeModal }, 'Закрыть')];
  if (doc) foot.push(el('button', { class:'btn', onclick: () => printStockDoc(doc.id) }, '🖨 Печать накладной'));
  if (editable) {
    if (doc) foot.push(el('button', { class:'btn btn-danger', onclick: async () => {
      if (!(await confirmModal({ title:'Удаление черновика', message:'Удалить черновик?', confirmText:'Удалить', danger:true }))) return;
      try { await window.__API__.apiFetch('stock-docs/' + doc.id, { method:'DELETE' }); closeModal(); toast('Черновик удалён', 'success'); if (onDone) onDone(); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    } }, 'Удалить'));
    foot.push(el('button', { class:'btn', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await saveDraft(); closeModal(); toast('Черновик сохранён', 'success'); if (onDone) onDone(); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; }
    } }, 'Сохранить черновик'));
    foot.push(el('button', { class:'btn btn-primary', onclick: async (e) => {
      if (!items.length) { toast('Добавьте позиции', 'warn'); return; }
      const b = e.currentTarget; b.disabled = true;
      try { const saved = await saveDraft(); await window.__API__.apiFetch('stock-docs/' + saved.id + '/post', { method:'POST' }); closeModal(); toast('Проведено, остаток обновлён', 'success'); if (onDone) onDone(); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; }
    } }, isIn ? 'Провести (оприходовать)' : 'Провести (списать)'));
  } else if (status === 'posted') {
    foot.push(el('button', { class:'btn btn-danger', onclick: async (e) => {
      if (!(await confirmModal({ title:'Отмена документа', message:'Отменить проведённый документ? Остаток будет восстановлен.', confirmText:'Отменить документ', danger:true }))) return;
      const b = e.currentTarget; b.disabled = true;
      try { await window.__API__.apiFetch('stock-docs/' + doc.id + '/cancel', { method:'POST' }); closeModal(); toast('Документ отменён', 'success'); if (onDone) onDone(); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; }
    } }, 'Отменить документ'));
  }

  const sp = { draft: ['pill-muted', 'Черновик'], posted: ['pill-success', 'Проведён'], cancelled: ['pill-danger', 'Отменён'] }[status] || ['pill-muted', status];
  // Левая панель — реквизиты документа, правая — товары (как в карточке сделки)
  const left = el('div', { class:'deal-left' }, [
    el('div', { class:'section-title' }, isIn ? 'Приход' : 'Расход'),
    el('div', { style:'margin-bottom:10px' }, el('span', { class:'pill ' + sp[0] }, sp[1])),
    el('div', { class:'form-row' }, [el('label', {}, isIn ? 'Поставщик' : 'Получатель / причина'), partyI]),
    el('div', { class:'form-row' }, [el('label', {}, 'Дата'), dateI]),
    el('div', { class:'form-row' }, [el('label', {}, 'Примечание'), noteI]),
  ]);
  const right = el('div', { class:'deal-right' }, [
    el('div', { style:'padding:12px 14px;overflow-y:auto;flex:1' }, [
      el('div', { class:'section-title' }, 'Товары'),
      itemsHost,
      pickerHost,
    ]),
  ]);
  openModal({
    wide: true,
    title: (isIn ? '📥 Приход' : '📤 Расход') + (doc ? ' · ' + doc.no : ''),
    body: el('div', { class:'deal-modal' }, [el('div', { class:'deal-split' }, [left, right])]),
    foot,
  });
}

// ============================================================
// VIEW: WAREHOUSE
// ============================================================
VIEWS.warehouse = () => {
  const wrap = el('div');

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Склад'),
    ]),
    el('div', { class: 'actions' }, [
      can('edit-stock') ? el('button', { class: 'btn btn-primary', onclick: () => openStockDoc('receipt', null, () => navigate('warehouse')) }, '📥 Приход') : null,
      can('edit-stock') ? el('button', { class: 'btn', onclick: () => openStockDoc('writeoff', null, () => navigate('warehouse')) }, '📤 Расход') : null,
      el('button', { class: 'btn', onclick: () => openMovementsReport() }, '📊 Отчёт движения'),
      can('edit-stock') ? el('button', { class: 'btn', onclick: () => openInventoryCreate() }, '+ Инвентаризация') : null,
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
  const q = { q: '', low: false, stockMin: '', stockMax: '', costMin: '', costMax: '', page: 1, limit: 50, total: 0 };
  const searchI = el('input', { placeholder:'Поиск по артикулу или названию…' });
  const lowChk = el('input', { type:'checkbox', style:'min-width:0;width:16px;height:16px;padding:0;margin:0;flex:none' });
  const lowLabel = el('label', { style:'display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#374151;white-space:nowrap' }, [lowChk, 'Только низкие остатки (<50)']);
  const stockMinI = el('input', { type:'number', placeholder:'от', onchange: e => { q.stockMin = e.target.value; q.page = 1; loadStock(); drawer.refreshBadge(); } });
  const stockMaxI = el('input', { type:'number', placeholder:'до', onchange: e => { q.stockMax = e.target.value; q.page = 1; loadStock(); drawer.refreshBadge(); } });
  const costMinI = el('input', { type:'number', placeholder:'от', onchange: e => { q.costMin = e.target.value; q.page = 1; loadStock(); drawer.refreshBadge(); } });
  const costMaxI = el('input', { type:'number', placeholder:'до', onchange: e => { q.costMax = e.target.value; q.page = 1; loadStock(); drawer.refreshBadge(); } });
  const drawer = buildFilterDrawer({
    groups: [
      el('div', { class:'filter-group' }, lowLabel),
      filterGroup('Остаток, шт', el('div', { class:'row2' }, [stockMinI, stockMaxI])),
      filterGroup('Закупочная цена, ₸', el('div', { class:'row2' }, [costMinI, costMaxI])),
    ],
    onReset: () => {
      Object.assign(q, { low: false, stockMin:'', stockMax:'', costMin:'', costMax:'', page: 1 });
      lowChk.checked = false; stockMinI.value=''; stockMaxI.value=''; costMinI.value=''; costMaxI.value='';
      loadStock();
    },
    countActive: () => (q.low ? 1 : 0) + [q.stockMin, q.stockMax, q.costMin, q.costMax].filter(v => v !== '' && v != null).length,
  });
  const tw = el('div', { class: 'table-wrap' });
  tw.append(el('div', { class: 'table-toolbar' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  tw.append(drawer.backdrop, drawer.drawer);
  const tableHost = el('div');
  tw.append(tableHost);
  wrap.append(tw);
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px' });
  wrap.append(pager);

  let deb;
  searchI.oninput = (e) => { clearTimeout(deb); const v = e.target.value; deb = setTimeout(() => { q.q = v; q.page = 1; loadStock(); }, 300); };
  lowChk.onchange = (e) => { q.low = e.target.checked; q.page = 1; loadStock(); drawer.refreshBadge(); };

  async function loadStock() {
    tableHost.innerHTML = ''; tableHost.append(el('div', { class:'muted', style:'padding:14px' }, 'Загрузка…'));
    try {
      let qs = `q=${encodeURIComponent(q.q)}&page=${q.page}&limit=${q.limit}` + (q.low ? '&lowstock=50' : '');
      if (q.stockMin !== '') qs += '&stock_min=' + encodeURIComponent(q.stockMin);
      if (q.stockMax !== '') qs += '&stock_max=' + encodeURIComponent(q.stockMax);
      if (q.costMin !== '') qs += '&cost_min=' + encodeURIComponent(q.costMin);
      if (q.costMax !== '') qs += '&cost_max=' + encodeURIComponent(q.costMax);
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

  // Документы склада (приход/расход) со статусами
  wrap.append(el('div', { style:'font-weight:600;margin:24px 0 12px' }, 'Документы склада (приход / расход)'));
  const docsHost = el('div', { class:'table-wrap' }, el('div', { class:'muted', style:'padding:12px' }, 'Загрузка…'));
  wrap.append(docsHost);
  function loadDocs() {
    window.__API__.apiFetch('stock-docs?limit=50').then(rows => {
      docsHost.innerHTML = '';
      const dt = el('table', { class:'data' });
      dt.append(el('thead', {}, el('tr', {}, [
        el('th', {}, '№'), el('th', {}, 'Дата'), el('th', {}, 'Тип'), el('th', {}, 'Контрагент'),
        el('th', { class:'num' }, 'Позиций'), el('th', {}, 'Статус'),
      ])));
      const stMap = { draft: ['pill-muted', 'Черновик'], posted: ['pill-success', 'Проведён'], cancelled: ['pill-danger', 'Отменён'] };
      dt.append(el('tbody', {}, (rows && rows.length) ? rows.map(d => {
        const sp = stMap[d.status] || ['pill-muted', d.status];
        return el('tr', { style:'cursor:pointer', onclick: () => openStockDoc(d.type, d.id, () => navigate('warehouse')) }, [
          el('td', { class:'strong' }, d.no),
          el('td', { class:'muted' }, d.date ? fmtDate(d.date) : '—'),
          el('td', {}, d.type === 'receipt' ? 'Приход' : 'Расход'),
          el('td', {}, d.counterparty || '—'),
          el('td', { class:'num' }, Math.round(d.total_qty || 0)),
          el('td', {}, el('span', { class:'pill ' + sp[0] }, sp[1])),
        ]);
      }) : [el('tr', {}, el('td', { colspan:6, class:'muted', style:'text-align:center;padding:16px' }, 'Документов пока нет. Создайте приход или расход.'))]));
      docsHost.append(dt);
    }).catch(() => { docsHost.innerHTML = ''; docsHost.append(el('div', { class:'muted', style:'padding:12px' }, 'Не удалось загрузить документы')); });
  }
  loadDocs();

  // Движения склада (приход/расход) — журнал
  wrap.append(el('div', { style:'font-weight:600;margin:24px 0 12px' }, 'Журнал движений склада'));
  const movHost = el('div', { class:'table-wrap' }, el('div', { class:'muted', style:'padding:12px' }, 'Загрузка…'));
  wrap.append(movHost);
  window.__API__.apiFetch('stock-movements?limit=50').then(rows => {
    movHost.innerHTML = '';
    const mt = el('table', { class:'data' });
    mt.append(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Дата'), el('th', {}, 'Товар'), el('th', {}, 'Тип'),
      el('th', { class:'num' }, 'Кол-во'), el('th', {}, 'Контрагент'), el('th', {}, 'Примечание'),
    ])));
    mt.append(el('tbody', {}, (rows && rows.length) ? rows.map(m => el('tr', {}, [
      el('td', { class:'muted' }, m.date ? fmtDate(m.date) : '—'),
      el('td', { class:'strong' }, m.product_name || m.product_sku || '—'),
      el('td', {}, el('span', { class:'pill ' + (m.direction === 'in' ? 'pill-success' : 'pill-warn') }, m.direction === 'in' ? 'Приход' : 'Расход')),
      el('td', { class:'num strong' }, (m.direction === 'in' ? '+' : '−') + m.qty),
      el('td', {}, m.counterparty || '—'),
      el('td', { class:'muted' }, m.note || ''),
    ])) : [el('tr', {}, el('td', { colspan:6, class:'muted', style:'text-align:center;padding:16px' }, 'Движений пока нет. Оформите приход или расход.'))]));
    movHost.append(mt);
  }).catch(() => { movHost.innerHTML = ''; movHost.append(el('div', { class:'muted', style:'padding:12px' }, 'Не удалось загрузить движения')); });

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
  const scanI = el('input', { placeholder:'Сканируйте или введите артикул + Enter', style:'flex:1;min-width:180px' });
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
      if (!(await confirmModal({ title:'Инвентаризация', message:`Провести инвентаризацию?\nОстатки на складе будут выставлены по факту (${counted} позиций). Действие необратимо.`, confirmText:'Провести', danger:true }))) return;
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
  // Сделки на этапе «Отгружено» показываем как отгрузки (без дублей с реальными ТТН)
  const isShippedStage = (sid) => /отгруж/i.test((stageById(sid) || {}).label || '');
  const shippedDeals = visibleDeals().filter(d => isShippedStage(d.stage) && !state.shipments.some(s => s.deal === d.id));

  wrap.append(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', {}, 'Отгрузки'),
      el('div', { class: 'sub' }, `${state.shipments.length + shippedDeals.length} отгрузок · ${shippedDeals.length} по сделкам`),
    ]),
    el('div', { class: 'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewShipment }, '+ Отгрузка')]),
  ]));

  // Нормализуем реальные отгрузки и «по сделке» в единый список для поиска/фильтров
  const normStatus = (s) => (s === 'delivered' || s === 'planned') ? s : 'shipped';
  const rowsData = [
    ...state.shipments.map(s => ({
      kind:'ship', id:s.id, deal:s.deal, no:s.no, date:s.date, client:s.client,
      dest:s.destination || '', transport:s.transport || '', driver:s.driver || '',
      positions:Number(s.items) || 0, weight:s.weight, status:normStatus(s.status),
    })),
    ...shippedDeals.map(d => ({
      kind:'deal', id:d.id, deal:d.id, no:d.title, date:d.target || d.created, client:d.client,
      dest:d.address || '', transport:'по сделке', driver:'',
      positions:Number(d.items) || 0, weight:null, status:'deal',
    })),
  ];

  // --- Поиск и фильтры ---
  const fs = { q:'', status:'', dateFrom:'', dateTo:'', posFrom:'', posTo:'' };
  const inputCss = 'min-width:0;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none;height:34px;box-sizing:border-box';
  const searchI = el('input', { placeholder:'Поиск по № ТТН/сделке, клиенту, «куда», транспорту…', style: inputCss + ';flex:1;min-width:240px', oninput: e => { fs.q = e.target.value.toLowerCase().trim(); refresh(); } });
  const statusS = el('select', { onchange: e => { fs.status = e.target.value; refresh(); } }, [
    el('option', { value:'' }, 'Все статусы'),
    el('option', { value:'planned' }, 'Запланировано'),
    el('option', { value:'shipped' }, 'В пути'),
    el('option', { value:'delivered' }, 'Доставлено'),
    el('option', { value:'deal' }, 'По сделке'),
  ]);
  const dateFromI = el('input', { type:'date', onchange: e => { fs.dateFrom = e.target.value; refresh(); } });
  const dateToI = el('input', { type:'date', onchange: e => { fs.dateTo = e.target.value; refresh(); } });
  const posFromI = el('input', { type:'number', min:'0', placeholder:'от', style: inputCss, oninput: e => { fs.posFrom = e.target.value; refresh(); } });
  const posToI = el('input', { type:'number', min:'0', placeholder:'до', style: inputCss, oninput: e => { fs.posTo = e.target.value; refresh(); } });
  const drawer = buildFilterDrawer({
    groups: [
      filterGroup('Статус', statusS),
      filterGroup('Период (дата)', el('div', { class:'row2' }, [dateFromI, dateToI])),
      filterGroup('Количество позиций', el('div', { class:'row2' }, [posFromI, posToI])),
    ],
    onReset: () => { Object.assign(fs, { status:'', dateFrom:'', dateTo:'', posFrom:'', posTo:'' }); statusS.value=''; dateFromI.value=''; dateToI.value=''; posFromI.value=''; posToI.value=''; refresh(); },
    countActive: () => ['status','dateFrom','dateTo','posFrom','posTo'].filter(k => fs[k]).length,
  });

  function matches(r) {
    if (fs.q) {
      const cl = clientById(r.client);
      const hay = (String(r.no) + ' ' + (cl ? cl.name : '') + ' ' + r.dest + ' ' + r.transport + ' ' + r.driver).toLowerCase();
      if (!hay.includes(fs.q)) return false;
    }
    if (fs.status && r.status !== fs.status) return false;
    if (fs.dateFrom || fs.dateTo) {
      const d = String(r.date || '').slice(0, 10);
      if (!d) return false;
      if (fs.dateFrom && d < fs.dateFrom) return false;
      if (fs.dateTo && d > fs.dateTo) return false;
    }
    if (fs.posFrom !== '' && r.positions < Number(fs.posFrom)) return false;
    if (fs.posTo !== '' && r.positions > Number(fs.posTo)) return false;
    return true;
  }

  const statusPill = (st) => st === 'delivered'
    ? el('span', { class:'pill pill-success' }, '✓ Доставлено')
    : st === 'planned'
      ? el('span', { class:'pill pill-info' }, '⏱ Запланировано')
      : st === 'deal'
        ? el('span', { class:'pill pill-warn' }, '🚚 Отгружена')
        : el('span', { class:'pill pill-warn' }, '🚚 В пути');

  function buildTbody() {
    const list = rowsData.filter(matches);
    const rows = list.map(r => {
      const cl = clientById(r.client);
      const onclick = () => { const dl = byId(state.deals, r.deal); if (dl) openDealDetail(dl.id); else openShipmentDetail(r.id); };
      return el('tr', { style:'cursor:pointer', onclick }, [
        el('td', { class:'strong' }, r.no),
        el('td', {}, r.date ? fmtDate(r.date) : '—'),
        el('td', {}, cl.name),
        el('td', { class:'muted' }, r.dest || '—'),
        el('td', {}, r.kind === 'deal'
          ? el('span', { class:'muted', style:'font-size:11.5px' }, 'по сделке')
          : [r.transport, el('div', { class:'muted', style:'font-size:11.5px' }, r.driver)]),
        el('td', { class:'num' }, r.positions),
        el('td', { class:'num' }, r.weight == null ? '—' : r.weight),
        el('td', {}, statusPill(r.status)),
      ]);
    });
    return el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: 8, class:'muted', style:'text-align:center;padding:20px' }, 'Отгрузок нет'))]);
  }

  const t = el('div', { class:'mt-16 table-wrap' });
  // Поиск всегда виден, остальные фильтры — за кнопкой «Фильтры»
  t.append(el('div', { class:'table-toolbar' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', {}, '№ ТТН / Сделка'),
    el('th', {}, 'Дата'),
    el('th', {}, 'Клиент'),
    el('th', {}, 'Куда'),
    el('th', {}, 'Транспорт / водитель'),
    el('th', { class:'num' }, 'Позиций'),
    el('th', { class:'num' }, 'Вес, кг'),
    el('th', {}, 'Статус'),
  ])));
  tab.append(buildTbody());
  t.append(tab);
  wrap.append(t);
  wrap.append(drawer.backdrop, drawer.drawer);

  function refresh() {
    const tb = tab.querySelector('tbody');
    if (tb) tb.replaceWith(buildTbody());
    drawer.refreshBadge();
  }
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
      el('div', { class: 'sub' }, `Счета · всего ${state.invoices.length}`),
    ]),
    el('div', { class: 'actions' }, [el('button', { class:'btn btn-primary', onclick: openNewInvoice }, '+ Счёт')]),
  ]));

  wrap.append(el('div', { class:'grid grid-3' }, [
    statCard('Оплачено',         fmtMoneyK(totalPaid),                                  '+12%', 'up',   '✅'),
    statCard('Ожидает оплаты',   fmtMoneyK(totalDue),                                   '', '',          '⏳'),
    statCard('Просрочено',       state.invoices.filter(i => i.status==='overdue').length, 'требует внимания', 'down', '⚠️'),
  ]));

  // --- Поиск и фильтры ---
  const fs = { q:'', status:'', due:'', dueFrom:'', dueTo:'' };
  const todayMs = new Date(new Date().toISOString().slice(0,10)).getTime();
  const daysUntil = (due) => { const s = String(due||'').slice(0,10); if (!s) return null; const t = new Date(s).getTime(); return isNaN(t) ? null : Math.round((t - todayMs)/86400000); };

  // Список документов = только реальные счета (строки «по сделке» больше не показываем)
  function computeDocs() {
    return state.invoices.map(iv => ({ invId: iv.id, no: iv.no, date: iv.date, client: iv.client, deal: iv.deal, amount: iv.amount, due: iv.due, status: iv.status, onopen: () => { const dl = byId(state.deals, iv.deal); if (dl) openDealDetail(dl.id); else openInvoiceDetail(iv.id); } }));
  }

  // Массовое редактирование: выбор счетов (только реальные счета, не строки «по сделке»)
  const isDirector = currentUser && currentUser.roleKey === 'director';
  const selected = new Set();
  let visibleInvIds = [];

  // Единый стиль для всех полей фильтра
  const inputCss = 'min-width:0;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;outline:none;height:34px;box-sizing:border-box';
  const searchI = el('input', { placeholder:'Поиск по № счёта, клиенту или сделке…', style: inputCss + ';flex:1;min-width:240px', oninput: e => { fs.q = e.target.value.toLowerCase().trim(); refresh(); } });
  const statusS = el('select', { onchange: e => { fs.status = e.target.value; refresh(); } }, [
    el('option', { value:'' }, 'Все статусы'),
    el('option', { value:'paid' }, 'Оплачено'),
    el('option', { value:'pending' }, 'Ожидает'),
    el('option', { value:'overdue' }, 'Просрочка'),
  ]);
  const dueS = el('select', { onchange: e => { fs.due = e.target.value; refresh(); } }, [
    el('option', { value:'' }, 'Все'),
    el('option', { value:'soon' }, 'Скоро к оплате (1–7 дн.)'),
    el('option', { value:'overdue' }, 'Просроченные'),
  ]);
  const dueFromI = el('input', { type:'date', onchange: e => { fs.dueFrom = e.target.value; refresh(); } });
  const dueToI = el('input', { type:'date', onchange: e => { fs.dueTo = e.target.value; refresh(); } });
  const drawer = buildFilterDrawer({
    groups: [
      filterGroup('Статус', statusS),
      filterGroup('Срок оплаты', dueS),
      filterGroup('Период срока оплаты', el('div', { class:'row2' }, [dueFromI, dueToI])),
    ],
    onReset: () => { Object.assign(fs, { status:'', due:'', dueFrom:'', dueTo:'' }); statusS.value=''; dueS.value=''; dueFromI.value=''; dueToI.value=''; refresh(); },
    countActive: () => ['status','due','dueFrom','dueTo'].filter(k => fs[k]).length,
  });

  function matchesDoc(doc) {
    if (fs.q) {
      const cl = clientById(doc.client); const dl = byId(state.deals, doc.deal);
      const hay = (String(doc.no) + ' ' + (cl ? cl.name : '') + ' ' + (dl ? dl.title : '')).toLowerCase();
      if (!hay.includes(fs.q)) return false;
    }
    if (fs.status && doc.status !== fs.status) return false;
    if (fs.due === 'soon') { const du = daysUntil(doc.due); if (du === null || du < 0 || du > 7) return false; }
    else if (fs.due === 'overdue') { const du = daysUntil(doc.due); const over = (du !== null && du < 0) || doc.status === 'overdue'; if (!over) return false; }
    if (fs.dueFrom || fs.dueTo) {
      const d = String(doc.due || '').slice(0,10);
      if (!d) return false;
      if (fs.dueFrom && d < fs.dueFrom) return false;
      if (fs.dueTo && d > fs.dueTo) return false;
    }
    return true;
  }

  const stPill = {
    paid:    () => el('span', { class:'pill pill-success' }, '✓ Оплачено'),
    pending: () => el('span', { class:'pill pill-warn' }, '⏳ Ожидает'),
    overdue: () => el('span', { class:'pill pill-danger' }, '⚠ Просрочка'),
  };
  function buildTbody() {
    const list = computeDocs().filter(matchesDoc);
    visibleInvIds = list.filter(d => d.invId).map(d => d.invId);
    const rows = list.map(doc => {
      const cl = clientById(doc.client); const dl = byId(state.deals, doc.deal);
      const cb = doc.invId ? el('input', { type:'checkbox', checked: selected.has(doc.invId) ? 'checked' : null,
        onclick: e => e.stopPropagation(),
        onchange: () => { if (cb.checked) selected.add(doc.invId); else selected.delete(doc.invId); refreshBulk(); } }) : null;
      return el('tr', { style:'cursor:pointer', onclick: doc.onopen }, [
        el('td', { style:'text-align:center', onclick: e => e.stopPropagation() }, cb),
        el('td', { class:'strong' }, doc.no),
        el('td', {}, doc.date ? fmtDate(doc.date) : '—'),
        el('td', {}, cl ? cl.name : '—'),
        el('td', { class:'muted' }, dl ? dl.title : '—'),
        el('td', { class:'num strong' }, fmtMoneyK(doc.amount)),
        el('td', {}, doc.due ? fmtDate(doc.due) : '—'),
        el('td', {}, (stPill[doc.status] || (() => el('span', { class:'muted' }, '—')))()),
      ]);
    });
    return el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: 8, class:'muted', style:'text-align:center;padding:20px' }, 'Документов нет'))]);
  }

  // --- Массовое редактирование ---
  const selAll = el('input', { type:'checkbox', title:'Выбрать все счета', onchange: () => {
    if (selAll.checked) visibleInvIds.forEach(id => selected.add(id)); else visibleInvIds.forEach(id => selected.delete(id));
    refresh();
  } });
  const bulkCount = el('span', { class:'strong' }, '');
  const bulkStatusSel = el('select', { style: inputCss + ';min-width:170px' }, [
    el('option', { value:'' }, 'Сменить статус…'),
    el('option', { value:'paid' }, 'Оплачено'),
    el('option', { value:'pending' }, 'Ожидает'),
    el('option', { value:'overdue' }, 'Просрочка'),
  ]);
  const applyStatusBtn = el('button', { class:'btn btn-sm btn-primary', onclick: () => bulkSetStatus(bulkStatusSel.value) }, 'Применить');
  const delBtn = isDirector ? el('button', { class:'btn btn-sm btn-danger', onclick: bulkDelete }, '🗑 Удалить') : null;
  const clearBtn = el('button', { class:'btn btn-sm', onclick: () => { selected.clear(); refresh(); } }, 'Снять выбор');
  const bulkBar = el('div', { class:'bulk-bar', style:'display:none' }, [bulkCount, bulkStatusSel, applyStatusBtn, delBtn, clearBtn]);

  function refreshBulk() {
    bulkCount.textContent = `Выбрано: ${selected.size}`;
    bulkBar.style.display = selected.size ? '' : 'none';
    selAll.checked = visibleInvIds.length > 0 && visibleInvIds.every(id => selected.has(id));
  }
  async function bulkSetStatus(status) {
    if (!status) { toast('Выберите новый статус', 'warn'); return; }
    const ids = [...selected]; if (!ids.length) return;
    applyStatusBtn.disabled = true;
    try {
      for (const id of ids) {
        const saved = await window.__API__.apiFetch('invoices/' + id, { method:'PUT', body:{ status_id: status } });
        const iv = byId(state.invoices, id);
        if (iv) { if (saved) Object.assign(iv, window.__API__.map.invoice(saved)); else iv.status = status; }
      }
      toast(`Статус обновлён · счетов: ${ids.length}`, 'success');
      selected.clear(); bulkStatusSel.value = ''; refresh();
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    applyStatusBtn.disabled = false;
  }
  async function bulkDelete() {
    const ids = [...selected]; if (!ids.length) return;
    if (!(await confirmModal({ title:'Удаление счетов', message:`Удалить выбранные счета (${ids.length})? Они переместятся в архив на 30 дней.`, confirmText:'Удалить', danger:true }))) return;
    if (delBtn) delBtn.disabled = true;
    try {
      for (const id of ids) {
        await window.__API__.apiFetch('invoices/' + id, { method:'DELETE' });
        const i = state.invoices.findIndex(x => x.id === id); if (i >= 0) state.invoices.splice(i, 1);
      }
      toast(`Удалено счетов: ${ids.length}`, 'success');
      selected.clear(); refresh();
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    if (delBtn) delBtn.disabled = false;
  }

  const tw = el('div', { class:'mt-16 table-wrap' });
  // Поиск всегда виден, остальные фильтры — за кнопкой «Фильтры»
  tw.append(el('div', { class:'table-toolbar' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  tw.append(bulkBar);
  const tab = el('table', { class:'data' });
  tab.append(el('thead', {}, el('tr', {}, [
    el('th', { style:'text-align:center;width:36px' }, selAll),
    el('th', {}, '№ счёта'), el('th', {}, 'Дата'), el('th', {}, 'Клиент'),
    el('th', {}, 'Сделка'), el('th', { class:'num' }, 'Сумма'), el('th', {}, 'Срок оплаты'), el('th', {}, 'Статус'),
  ])));
  tab.append(buildTbody());
  tw.append(tab);
  wrap.append(tw);
  wrap.append(drawer.backdrop, drawer.drawer);
  refreshBulk();

  function refresh() {
    const tb = tab.querySelector('tbody');
    if (tb) tb.replaceWith(buildTbody());
    refreshBulk();
    drawer.refreshBadge();
  }
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

  // Поиск по названию / БИН / контакту / телефону / email
  let q = '', page = 1; const PAGE_SIZE = 12;
  const searchI = el('input', { placeholder:'Поиск поставщика…', style:'flex:1;min-width:240px', oninput: e => { q = e.target.value.toLowerCase().trim(); page = 1; renderGrid(); } });
  const tw = el('div', { class:'table-wrap' });
  tw.append(el('div', { class:'table-toolbar' }, [searchI]));
  wrap.append(tw);

  const grid = el('div', { class:'grid grid-3', style:'margin-top:16px' });
  const pager = el('div', { class:'row', style:'justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:8px' });
  function renderGrid() {
    const list = state.suppliers.filter(s => !q || (String(s.name||'') + ' ' + (s.bin||'') + ' ' + (s.contact||'') + ' ' + (s.phone||'') + ' ' + (s.email||'')).toLowerCase().includes(q));
    grid.innerHTML = ''; pager.innerHTML = '';
    if (!list.length) { grid.append(el('div', { class:'muted', style:'padding:16px' }, q ? 'Ничего не найдено' : 'Поставщиков нет')); return; }
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > pages) page = pages;
    list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(s => {
      grid.append(el('div', { class:'card', style:'cursor:pointer', title:'Открыть и редактировать поставщика', onclick: () => openSupplierDetail(s.id) }, [
        el('div', { class:'row', style:'justify-content:space-between;margin-bottom:8px' }, [
          el('div', { class:'strong', style:'font-size:15px' }, s.name),
          el('span', { class:'pill pill-info' }, s.share + '% закупок'),
        ]),
        el('div', { class:'bar-mini' }, el('div', { style:`width:${s.share}%` })),
        el('dl', { class:'kv mt-12', style:'grid-template-columns:120px 1fr' }, [
          el('dt', {}, 'БИН'),           el('dd', {}, s.bin || '—'),
          el('dt', {}, 'Контакт'),       el('dd', {}, s.contact || '—'),
          el('dt', {}, 'Телефон'),       el('dd', {}, s.phone || '—'),
          el('dt', {}, 'Email'),         el('dd', {}, s.email || '—'),
          el('dt', {}, 'Последняя поставка'), el('dd', {}, s.lastDelivery ? fmtDate(s.lastDelivery) : '—'),
        ]),
        el('div', { class:'muted mt-12', style:'font-size:12px;line-height:1.4' }, s.note || ''),
      ]));
    });
    const from = (page - 1) * PAGE_SIZE + 1, to = Math.min(list.length, page * PAGE_SIZE);
    pager.append(
      el('div', { class:'muted', style:'font-size:12px' }, `Показано ${from}–${to} из ${list.length} · стр. ${page} из ${pages}`),
      el('div', { class:'row', style:'gap:6px' }, [
        el('button', { class:'btn btn-sm', disabled: page <= 1 ? 'disabled' : null, onclick: () => { if (page > 1) { page--; renderGrid(); } } }, '← Назад'),
        el('button', { class:'btn btn-sm', disabled: page >= pages ? 'disabled' : null, onclick: () => { if (page < pages) { page++; renderGrid(); } } }, 'Вперёд →'),
      ]),
    );
  }
  renderGrid();
  wrap.append(grid);
  wrap.append(pager);

  // Тихо подтягиваем актуальный список из БД (его наполняет фоновая синхронизация с 1С),
  // чтобы новые поставщики появлялись со временем без ручных действий и перезагрузки.
  (async () => {
    try {
      const list = await window.__API__.apiFetch('suppliers');
      if (Array.isArray(list)) { state.suppliers = list.map(window.__API__.map.supplier); page = 1; renderGrid(); }
    } catch (e) { /* офлайн/ошибка — оставляем текущие данные */ }
  })();

  return wrap;
};

// ============================================================
// VIEW: TASKS
// ============================================================
// ---------- Задачи: канбан по срокам ----------
const TASK_COLS = [
  { key:'overdue',  label:'Просрочено',  color:'#EF4444' },
  { key:'today',    label:'Сегодня',     color:'#F59E0B' },
  { key:'tomorrow', label:'Завтра',      color:'#3B82F6' },
  { key:'week',     label:'Неделя',      color:'#8B5CF6' },
  { key:'month',    label:'Месяц',       color:'#10B981' },
];
const TASK_STATUS = [
  { value:'new',         label:'Новая' },
  { value:'in_progress', label:'В работе' },
  { value:'done',        label:'Выполнена' },
];
const taskStatusLabel = (s) => (TASK_STATUS.find(x => x.value === s) || {}).label || 'Новая';
let TASKS_OWNER = '';      // фильтр по ответственному (id) или '' = все
let TASKS_FROM = '';       // фильтр по диапазону срока: с (YYYY-MM-DD)
let TASKS_TO = '';         // фильтр по диапазону срока: по (YYYY-MM-DD)
let TASKS_SHOWDONE = false; // показывать выполненные (канбан)
let TASKS_VIEW = 'kanban'; // 'kanban' | 'list'
let TASKS_STATUS = '';     // фильтр по статусу в списке: '' | 'open' | 'overdue' | 'done'

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function parseDue(due) { return new Date(String(due || '').replace(' ', 'T')); }
// Колонка по сроку: просрочено / сегодня / завтра / эта неделя / этот месяц (и далее)
function taskBucket(t) {
  if (!t.due) return 'month';
  const today = startOfDay(new Date());
  const d = startOfDay(parseDue(t.due));
  if (isNaN(d.getTime())) return 'month';
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  const g = today.getDay(); const daysToSun = g === 0 ? 0 : 7 - g;
  const endWeek = startOfDay(new Date(today.getTime() + daysToSun * 86400000));
  if (d <= endWeek) return 'week';
  return 'month';
}
// Дата, на которую ставим срок при переносе карточки в колонку
function bucketTargetDue(key) {
  const today = startOfDay(new Date());
  const iso = (d) => { const p = (n) => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); };
  let d;
  if (key === 'today') d = today;
  else if (key === 'tomorrow') d = new Date(today.getTime() + 86400000);
  else if (key === 'week') { const g = today.getDay(); const daysToSun = g === 0 ? 0 : 7 - g; d = new Date(today.getTime() + daysToSun * 86400000); }
  else if (key === 'month') d = new Date(today.getFullYear(), today.getMonth() + 1, 0); // последний день месяца
  else return null;
  return iso(d) + ' 18:00';
}

VIEWS.tasks = () => {
  const wrap = el('div');
  const base = visibleTasks(); // с учётом роли (менеджер — только свои)
  const isList = TASKS_VIEW === 'list';
  const selected = new Set();   // выбранные задачи (режим списка) для массового редактирования
  const doneCount = base.filter(t => t.done).length;
  const inRange = (t) => {
    if (!TASKS_FROM && !TASKS_TO) return true;
    const d = String(t.due || '').slice(0, 10);
    if (!d) return false;
    if (TASKS_FROM && d < TASKS_FROM) return false;
    if (TASKS_TO && d > TASKS_TO) return false;
    return true;
  };
  const matchFilters = (t) => (!TASKS_OWNER || t.owner === TASKS_OWNER) && inRange(t);
  const openFiltered = base.filter(t => !t.done && matchFilters(t));
  const doneFiltered = base.filter(t => t.done && matchFilters(t));
  const overdueN = openFiltered.filter(t => taskDue(t).kind === 'overdue').length;
  const todayN = openFiltered.filter(t => taskDue(t).kind === 'today').length;
  const subParts = [`${openFiltered.length} открытых · ${doneCount} выполнено`];
  if (overdueN) subParts.push(`⚠️ ${overdueN} просрочено`);
  if (todayN) subParts.push(`🔔 ${todayN} на сегодня`);

  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Задачи'), el('div', { class:'sub' }, subParts.join(' · '))]),
    el('div', { class:'actions' }, [
      el('button', { class:'btn', onclick: () => { TASKS_VIEW = isList ? 'kanban' : 'list'; navigate('tasks'); } }, isList ? '🗂 Канбан' : '📋 Список'),
      el('button', { class:'btn btn-primary', onclick: () => openNewTask() }, '+ Задача'),
    ]),
  ]));

  // Фильтры (сотрудник, срок, статус/выполненные) — за кнопкой «Фильтры»
  const groups = [];
  let ownerSel = null;
  if (role().seeAllData) {
    ownerSel = el('select', {}, [el('option', { value:'' }, 'Все сотрудники'),
      ...state.users.filter(u => u.active !== false).map(u => el('option', { value:u.id }, u.name))]);
    ownerSel.value = TASKS_OWNER;
    ownerSel.onchange = () => { TASKS_OWNER = ownerSel.value; navigate('tasks'); };
    groups.push(filterGroup('Сотрудник', ownerSel));
  }
  const fromI = el('input', { type:'date', value: TASKS_FROM });
  const toI = el('input', { type:'date', value: TASKS_TO });
  fromI.onchange = () => { TASKS_FROM = fromI.value; navigate('tasks'); };
  toI.onchange = () => { TASKS_TO = toI.value; navigate('tasks'); };
  groups.push(filterGroup('Срок', el('div', { class:'row2' }, [fromI, toI])));
  if (isList) {
    const stSel = el('select', {}, [
      el('option', { value:'' }, 'Все статусы'),
      el('option', { value:'open' }, 'Открыта'),
      el('option', { value:'overdue' }, 'Просрочена'),
      el('option', { value:'done' }, 'Выполнена'),
    ]);
    stSel.value = TASKS_STATUS;
    stSel.onchange = () => { TASKS_STATUS = stSel.value; navigate('tasks'); };
    groups.push(filterGroup('Статус', stSel));
  } else {
    const doneChk = el('input', { type:'checkbox', checked: TASKS_SHOWDONE ? 'checked' : null, style:'width:16px;height:16px' });
    doneChk.onchange = () => { TASKS_SHOWDONE = doneChk.checked; navigate('tasks'); };
    groups.push(el('div', { class:'filter-group' }, el('label', { style:'display:inline-flex;align-items:center;gap:8px;margin:0;font-size:13px;color:var(--ink)' }, [doneChk, 'Показывать выполненные'])));
  }
  const drawer = buildFilterDrawer({
    groups,
    onReset: () => { TASKS_OWNER=''; TASKS_FROM=''; TASKS_TO=''; TASKS_STATUS=''; navigate('tasks'); },
    countActive: () => [TASKS_OWNER, TASKS_FROM, TASKS_TO, (isList ? TASKS_STATUS : '')].filter(Boolean).length,
  });
  wrap.append(el('div', { class:'table-toolbar', style:'margin-bottom:12px' }, [ el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  wrap.append(drawer.backdrop, drawer.drawer);

  const byDue = (a, b) => String(a.due || '').localeCompare(String(b.due || ''));

  const prLabel = { high:'высокий', medium:'средний', low:'низкий' };
  function taskCard(t) {
    const u = userById(t.owner);
    const prCls = t.priority === 'high' ? 'pill-danger' : t.priority === 'medium' ? 'pill-warn' : 'pill-muted';
    const dateStr = t.due ? fmtDate(String(t.due).split(' ')[0]) : '—';
    const timeStr = String(t.due || '').slice(11, 16);
    const od = !t.done && taskDue(t).kind === 'overdue';
    return el('div', { class:'k-card', style:'cursor:pointer' + (od ? ';border-left:3px solid #EF4444' : ''), onclick: () => openTaskDetail(t.id) }, [
      // приоритет — сверху
      el('div', { style:'display:flex;align-items:center;gap:6px;margin-bottom:6px' }, [
        el('span', { class:'pill ' + prCls, style:'font-size:10px' }, prLabel[t.priority] || t.priority),
        od ? el('span', { class:'pill pill-danger', style:'font-size:10px' }, 'просрочено') : null,
      ]),
      // название
      el('div', { class:'k-card-title', style:'margin:0' + (t.done ? ';text-decoration:line-through;color:#9CA3AF' : '') }, t.title),
      // менеджер
      el('div', { style:'display:flex;align-items:center;gap:6px;margin-top:8px' }, [
        el('span', { class:'avatar', style:`width:20px;height:20px;font-size:9px;background:${u.color}`, title:u.name }, u.avatar),
        el('span', { class:'muted', style:'font-size:11.5px' }, u.name),
      ]),
      // дата окончания + время
      el('div', { class:'muted', style:'font-size:11.5px;margin-top:6px;display:flex;align-items:center;gap:10px' }, [
        el('span', {}, '📅 ' + dateStr),
        timeStr ? el('span', {}, '🕒 ' + timeStr) : null,
      ]),
      el('button', { class:'btn btn-sm', style:'margin-top:8px;width:100%', onclick: async (e) => {
        e.stopPropagation();
        const next = t.done ? 0 : 1;
        try { await window.__API__.apiFetch('tasks/' + t.id, { method:'PUT', body:{ done: next, status: next ? 'done' : 'in_progress' } }); const tt = byId(state.tasks, t.id); if (tt) { tt.done = !!next; tt.status = next ? 'done' : 'in_progress'; } toast(next ? 'Задача выполнена' : 'Возвращена в работу', 'success'); navigate('tasks'); }
        catch (err) { toast('Не удалось сохранить', 'error'); }
      } }, t.done ? '↩ В работу' : '✓ Выполнить'),
    ]);
  }

  function column(label, color, tasks) {
    const body = el('div', { class:'k-col-body' });
    if (tasks.length) tasks.forEach(t => body.append(taskCard(t)));
    else body.append(el('div', { class:'muted', style:'font-size:12px;text-align:center;padding:18px 6px' }, 'Нет задач'));
    return el('div', { class:'k-col' }, [
      el('div', { class:'k-col-head' }, [
        el('span', { class:'stage-dot', style:`background:${color}` }),
        el('span', { class:'stage-label' }, label),
        el('span', { class:'stage-count' }, tasks.length),
      ]),
      body,
    ]);
  }

  // Режим списка: таблица с основными полями + массовое редактирование (как в «Сделках»)
  function buildTasksList() {
    // статус задачи: выполнена / просрочена / открыта
    const statusOf = (t) => t.done ? 'done' : (taskDue(t).kind === 'overdue' ? 'overdue' : 'open');
    const rows = base.filter(matchFilters)
      .filter(t => !TASKS_STATUS || statusOf(t) === TASKS_STATUS)
      .slice().sort(byDue);
    const tw = el('div', { class:'table-wrap' });
    const countSpan = el('span', { class:'strong' }, '');
    const rowChecks = [];
    const selAll = el('input', { type:'checkbox', title:'Выбрать все' });
    const bulkBar = el('div', { class:'bulk-bar', style:'display:none' }, [
      countSpan,
      el('button', { class:'btn btn-sm btn-primary', onclick: () => openTaskBulkEdit([...selected]) }, 'Массовое редактирование'),
      el('button', { class:'btn btn-sm', onclick: () => { selected.clear(); rowChecks.forEach(c => { c.checked = false; }); selAll.checked = false; refreshBulk(); } }, 'Снять выбор'),
    ]);
    function refreshBulk() { countSpan.textContent = `Выбрано: ${selected.size}`; bulkBar.style.display = selected.size ? '' : 'none'; }
    selAll.onchange = () => { rows.forEach((t, i) => { if (selAll.checked) selected.add(t.id); else selected.delete(t.id); if (rowChecks[i]) rowChecks[i].checked = selAll.checked; }); refreshBulk(); };

    const tbl = el('table', { class:'data' });
    tbl.append(el('thead', {}, el('tr', {}, [
      el('th', { style:'width:34px;text-align:center' }, selAll),
      el('th', {}, 'Задача'), el('th', {}, 'Ответственный'), el('th', {}, 'Приоритет'),
      el('th', {}, 'Срок'), el('th', {}, 'Статус'), el('th', {}, 'Сделка'),
    ])));
    tbl.append(el('tbody', {}, rows.length ? rows.map((t, i) => {
      const u = userById(t.owner);
      const prCls = t.priority === 'high' ? 'pill-danger' : t.priority === 'medium' ? 'pill-warn' : 'pill-muted';
      const od = !t.done && taskDue(t).kind === 'overdue';
      const dl = t.deal ? byId(state.deals, t.deal) : null;
      const dStr = String(t.due || ''); const dueStr = dStr ? fmtDate(dStr.split(' ')[0]) + (dStr.slice(11, 16) ? ' ' + dStr.slice(11, 16) : '') : '—';
      const statusPill = t.done ? el('span', { class:'pill pill-success' }, 'Выполнена')
        : (od ? el('span', { class:'pill pill-danger' }, 'Просрочена') : el('span', { class:'pill pill-muted' }, 'Открыта'));
      const cb = el('input', { type:'checkbox', onclick: (e) => e.stopPropagation(), onchange: () => { if (cb.checked) selected.add(t.id); else selected.delete(t.id); selAll.checked = rows.length > 0 && rows.every(x => selected.has(x.id)); refreshBulk(); } });
      rowChecks[i] = cb;
      return el('tr', { style:'cursor:pointer', onclick: () => openTaskDetail(t.id) }, [
        el('td', { style:'text-align:center', onclick: (e) => e.stopPropagation() }, cb),
        el('td', { class:'strong', style: t.done ? 'text-decoration:line-through;color:#9CA3AF' : '' }, t.title),
        el('td', {}, el('span', { class:'avatar', style:`background:${u.color};width:26px;height:26px;font-size:11px`, title:u.name }, u.avatar)),
        el('td', {}, el('span', { class:'pill ' + prCls }, prLabel[t.priority] || t.priority)),
        el('td', { class:'muted' }, dueStr),
        el('td', {}, statusPill),
        el('td', { class:'muted' }, dl ? dl.title : '—'),
      ]);
    }) : [el('tr', {}, el('td', { colspan:7, class:'muted', style:'text-align:center;padding:24px' }, 'Задач не найдено'))]));
    tw.append(bulkBar, tbl);
    refreshBulk();
    return tw;
  }

  if (isList) {
    wrap.append(buildTasksList());
  } else {
    const kanban = el('div', { class:'kanban' });
    TASK_COLS.forEach(col => kanban.append(column(col.label, col.color, openFiltered.filter(t => taskBucket(t) === col.key).sort(byDue))));
    if (TASKS_SHOWDONE) kanban.append(column('Выполнено', '#9CA3AF', doneFiltered.slice().sort(byDue).reverse()));
    wrap.append(kanban);
  }
  return wrap;
};

// Карточка задачи: просмотр и редактирование деталей
function openTaskDetail(id, returnDealId) {
  const t = byId(state.tasks, id);
  if (!t) return;
  const backToDeal = (typeof returnDealId === 'string') ? returnDealId : null; // вернуться в карточку сделки
  const goBack = () => { if (backToDeal) openDealDetail(backToDeal, { tab: 'tasks' }); else navigate('tasks'); };
  const canEdit = role().seeAllData || t.owner === currentUser.id;

  const title = fInput('Название', t.title || '');
  const desc = fTextarea('Описание', t.description || '');
  const owner = fSelect('Ответственный', state.users.map(u => ({ value: u.id, label: u.name + ' · ' + u.role })), t.owner);
  const prio = fSelect('Приоритет', [{value:'low',label:'низкий'},{value:'medium',label:'средний'},{value:'high',label:'высокий'}], t.priority || 'medium');
  const due = fDateField('Дата окончания', String(t.due || '').slice(0, 10));
  const time = fTimeField('Время выполнения', (String(t.due || '').slice(11, 16) || '18:00'));
  const dealSel = fSelect('Связанная сделка', [{ value:'', label:'— Не связана —' }, ...state.deals.map(d => ({ value:d.id, label:d.title }))], t.deal || '');

  const fields = [title, desc, prio, owner, dealSel, due, time];
  if (!canEdit) fields.forEach(f => f.row.querySelectorAll('input,select,textarea').forEach(i => i.disabled = true));

  const foot = [el('button', { class:'btn', onclick: () => { closeModal(); if (backToDeal) openDealDetail(backToDeal, { tab: 'tasks' }); } }, 'Закрыть')];
  if (canEdit) {
    foot.push(el('button', { class:'btn btn-danger', onclick: async () => {
      if (!(await confirmModal({ title:'Удаление задачи', message:`Удалить задачу «${t.title}»?`, confirmText:'Удалить', danger:true }))) return;
      try {
        await window.__API__.apiFetch('tasks/' + t.id, { method:'DELETE' });
        const i = state.tasks.findIndex(x => x.id === t.id); if (i >= 0) state.tasks.splice(i, 1);
        closeModal(); toast('Задача удалена', 'success'); goBack();
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    } }, 'Удалить'));
    foot.push(el('button', { class:'btn btn-primary', onclick: async () => {
      if (!title.get().trim()) { toast('Введите название', 'warn'); return; }
      if (!due.getDate()) { toast('Укажите дату окончания', 'warn'); return; }
      if (time.raw() && !time.get()) { toast('Неверное время (формат ЧЧ:ММ)', 'warn'); return; }
      const upd = {
        id: t.id, title: title.get().trim(), description: desc.get(), owner: owner.get(),
        due: due.getDate() + ' ' + (time.get() || '18:00'), priority: prio.get(),
        deal: dealSel.get() || null,
      };
      try {
        const saved = await window.__API__.apiFetch('tasks/' + t.id, { method:'PUT', body: window.__API__.toApi.task(upd) });
        Object.assign(t, window.__API__.map.task(saved));
        closeModal(); toast('Задача сохранена', 'success'); goBack();
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    } }, 'Сохранить'));
  }

  openModal({ title: 'Редактирование задачи', body: el('div', {}, fields.map(f => f.row)), foot });
}

// Массовое редактирование выбранных задач: заполните нужные поля (пустые — не меняются)
function openTaskBulkEdit(ids) {
  const total = ids.length;
  if (!total) { toast('Не выбрано ни одной задачи', 'warn'); return; }
  const ownerSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), ...state.users.filter(u => u.active !== false).map(u => el('option', { value:u.id }, u.name))]);
  const prioSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), el('option', { value:'low' }, 'низкий'), el('option', { value:'medium' }, 'средний'), el('option', { value:'high' }, 'высокий')]);
  const dealSel = el('select', {}, [el('option', { value:'' }, 'Не менять'), el('option', { value:'__none__' }, 'Отвязать от сделки'), ...state.deals.map(d => el('option', { value:d.id }, d.title))]);
  const due = fDateField('Срок (дата окончания)', '');
  const fieldRow = (label, ctrl) => el('div', { class:'form-row' }, [el('label', {}, label), ctrl]);

  const applyBtn = el('button', { class:'btn btn-primary', onclick: async () => {
    const body = {};
    if (ownerSel.value) body.owner_id = ownerSel.value;
    if (prioSel.value) body.priority_id = prioSel.value;
    if (dealSel.value) body.deal_id = dealSel.value === '__none__' ? null : dealSel.value;
    if (due.getDate()) body.due = due.getDate() + ' 18:00';
    if (!Object.keys(body).length) { toast('Заполните хотя бы одно поле', 'warn'); return; }
    applyBtn.disabled = true;
    try {
      for (let i = 0; i < ids.length; i += 8) { // батчами, чтобы не упереться в лимиты
        await Promise.all(ids.slice(i, i + 8).map(id => window.__API__.apiFetch('tasks/' + id, { method:'PUT', body }).then(() => {
          const t = byId(state.tasks, id);
          if (t) {
            if ('owner_id' in body) t.owner = body.owner_id;
            if ('priority_id' in body) t.priority = body.priority_id;
            if ('deal_id' in body) t.deal = body.deal_id;
            if ('due' in body) t.due = body.due;
          }
        })));
      }
      closeModal(); toast(`Изменено задач: ${ids.length}`, 'success'); navigate('tasks');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); applyBtn.disabled = false; }
  } }, `Применить к ${total}`);

  openModal({
    title: `Массовое редактирование · ${total} ${plural(total, 'задача', 'задачи', 'задач')}`,
    body: el('div', {}, [
      el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Заполните только те поля, которые нужно изменить. Пустые поля остаются без изменений.'),
      fieldRow('Ответственный', ownerSel),
      fieldRow('Приоритет', prioSel),
      fieldRow('Связанная сделка', dealSel),
      due.row,
    ]),
    foot: [el('button', { class:'btn', onclick: closeModal }, 'Отмена'), applyBtn],
  });
}


// ============================================================
// VIEW: REPORTS
// ============================================================
VIEWS.reports = () => {
  const wrap = el('div');
  const now = new Date();
  const monthName = now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Отчёты'), el('div', { class:'sub' }, `${monthName} · по реальным данным CRM (используйте фильтр для уточнения)`)]),
    el('div', { class:'actions' }, [el('button', { class:'btn', onclick: () => exportReportPDF() }, '📥 Экспорт PDF')]),
  ]));

  // ----- Кнопка «Фильтр» (слева) + боковая панель фильтров -----
  const f = { manager: '', from: '', to: '', stage: '', minSum: '', maxSum: '', pipeline: '' };
  const mgrSel = el('select', { onchange: e => { f.manager = e.target.value; loadReports(); } },
    [el('option', { value:'' }, 'Все менеджеры')].concat(state.users.filter(u => u.active !== false).map(u => el('option', { value: u.id }, u.name))));
  // Воронка: при выборе список этапов зависит от неё (список воронок — из актуального источника)
  const pipeSel = el('select', { onchange: e => { f.pipeline = e.target.value; f.stage = ''; rebuildStages(); loadReports(); } });
  function rebuildPipes() {
    pipeSel.innerHTML = '';
    pipeSel.append(el('option', { value:'' }, 'Все воронки'));
    PIPELINES.forEach(pp => pipeSel.append(el('option', { value: pp.id }, pp.name)));
    if (!PIPELINES.some(pp => pp.id === f.pipeline)) f.pipeline = '';
    pipeSel.value = f.pipeline;
  }
  rebuildPipes();
  const stageSel = el('select', { onchange: e => { f.stage = e.target.value; loadReports(); } });
  // Этапы из актуальных воронок (синхронно со «Сделками»): по выбранной воронке — её этапы;
  // без воронки — уникальные названия (без дублей), значение = все id этапов с этим названием.
  function stageOptions() {
    if (f.pipeline) return pipelineStages(f.pipeline).map(s => ({ value: s.id, label: s.label }));
    const byLabel = new Map();
    STAGES.forEach(s => { const a = byLabel.get(s.label) || []; a.push(s.id); byLabel.set(s.label, a); });
    return [...byLabel.entries()].map(([label, ids]) => ({ value: ids.join(','), label }));
  }
  function rebuildStages() {
    stageSel.innerHTML = '';
    stageSel.append(el('option', { value:'' }, 'Все этапы'));
    stageOptions().forEach(o => stageSel.append(el('option', { value: o.value }, o.label)));
    stageSel.value = f.stage;
  }
  rebuildStages();
  const fromI = el('input', { type:'date', onchange: e => { f.from = e.target.value; loadReports(); } });
  const toI = el('input', { type:'date', onchange: e => { f.to = e.target.value; loadReports(); } });
  const minI = el('input', { type:'number', placeholder:'от', onchange: e => { f.minSum = e.target.value; loadReports(); } });
  const maxI = el('input', { type:'number', placeholder:'до', onchange: e => { f.maxSum = e.target.value; loadReports(); } });

  const filterBadge = el('span', { class:'badge', style:'display:none;margin-left:2px;background:var(--brand);color:#fff' }, '');
  const filterBtn = el('button', { class:'btn', onclick: () => openDrawer() }, [svgIconEl('filter', 16), ' Фильтры', filterBadge]);
  const backdrop = el('div', { class:'drawer-backdrop', onclick: () => closeDrawer() });
  const drawer = el('div', { class:'filter-drawer' }, [
    el('div', { class:'fd-head' }, [
      el('h3', { style:'margin:0;font-size:15px' }, 'Фильтры'),
      el('button', { class:'fd-close', title:'Закрыть', onclick: () => closeDrawer() }, '×'),
    ]),
    el('div', { class:'fd-body' }, [
      el('div', { class:'filter-group' }, [el('label', {}, 'Период (создание сделки)'), el('div', { class:'row2' }, [fromI, toI])]),
      el('div', { class:'filter-group' }, [el('label', {}, 'Менеджер'), mgrSel]),
      el('div', { class:'filter-group' }, [el('label', {}, 'Воронка'), pipeSel]),
      el('div', { class:'filter-group' }, [el('label', {}, 'Этап воронки'), stageSel]),
      el('div', { class:'filter-group' }, [el('label', {}, 'Сумма сделки, ₸'), el('div', { class:'row2' }, [minI, maxI])]),
    ]),
    el('div', { class:'fd-foot' }, [
      el('button', { class:'btn', style:'flex:1', onclick: () => resetFilters() }, 'Сбросить'),
      el('button', { class:'btn btn-primary', style:'flex:1', onclick: () => closeDrawer() }, 'Готово'),
    ]),
  ]);
  function openDrawer() { backdrop.classList.add('open'); drawer.classList.add('open'); }
  function closeDrawer() { backdrop.classList.remove('open'); drawer.classList.remove('open'); }
  function resetFilters() {
    f.manager = ''; f.from = ''; f.to = ''; f.stage = ''; f.minSum = ''; f.maxSum = ''; f.pipeline = '';
    mgrSel.value = ''; pipeSel.value = ''; fromI.value = ''; toI.value = ''; minI.value = ''; maxI.value = '';
    rebuildStages();
    loadReports();
  }
  wrap.append(el('div', { style:'margin-bottom:16px' }, [filterBtn]));
  wrap.append(backdrop, drawer);

  // helper: «YYYY-MM» -> «мес ГГ»
  const MON = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const monLabel = (m) => { const [y, mm] = String(m).split('-'); return (MON[(+mm) - 1] || m) + ' ' + String(y).slice(2); };
  const noData = (text) => el('div', { class:'muted', style:'padding:28px;text-align:center' }, text);

  // ----- Сводные счётчики: сделки (по фильтрам) + задачи (период+менеджер) -----
  const dealsTotalVal = el('div', { class:'stat-value' }, '—');
  const dealsTotalCard = el('div', { class:'card stat' }, [
    el('div', { class:'stat-icon' }, '💼'), el('div', { class:'stat-label' }, 'Всего сделок'), dealsTotalVal,
  ]);
  const statRef = (label, icon) => {
    const v = el('div', { class:'stat-value' }, '—');
    return { card: el('div', { class:'card stat' }, [el('div', { class:'stat-icon' }, icon), el('div', { class:'stat-label' }, label), v]), v };
  };
  const tTotal = statRef('Всего задач', '✅');
  const tDoneC = statRef('Выполнено задач', '✓');
  const tOpenC = statRef('Не выполнено', '⏳');
  wrap.append(el('div', { class:'grid grid-4', style:'margin-bottom:16px' }, [dealsTotalCard, tTotal.card, tDoneC.card, tOpenC.card]));
  // Пересчёт задач: фильтр по периоду (срок задачи) и менеджеру (исполнитель)
  function updateTaskStats() {
    let ts = visibleTasks();
    if (f.manager) ts = ts.filter(t => t.owner === f.manager);
    if (f.from || f.to) ts = ts.filter(t => {
      const d = String(t.due || '').slice(0, 10);
      if (!d) return false;
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      return true;
    });
    const done = ts.filter(t => t.done).length;
    tTotal.v.textContent = String(ts.length);
    tDoneC.v.textContent = String(done);
    tOpenC.v.textContent = String(ts.length - done);
  }

  // ----- Сделки по этапам (количество, с учётом фильтров) -----
  const stageCard = el('div', { class:'card' });
  stageCard.append(el('div', { class:'card-head' }, el('h3', {}, 'Сделки по этапам')));
  const stageHost = el('div', { style:'padding:8px 4px' }, noData('Загрузка…'));
  stageCard.append(stageHost);
  wrap.append(stageCard);

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

  // Загрузка реальных агрегатов и отрисовка (перезапрашивается при смене фильтров)
  function loadReports() {
    const activeCount = [f.manager, f.from, f.to, f.stage, f.minSum, f.maxSum, f.pipeline].filter(v => v !== '' && v != null).length;
    filterBadge.style.display = activeCount ? '' : 'none';
    filterBadge.textContent = String(activeCount);
    updateTaskStats(); // задачи пересчитываются сразу (период + менеджер), не дожидаясь ответа сервера
    const qp = new URLSearchParams();
    if (f.manager) qp.set('manager', f.manager);
    if (f.from) qp.set('from', f.from);
    if (f.to) qp.set('to', f.to);
    if (f.pipeline) qp.set('pipeline', f.pipeline);
    if (f.stage) qp.set('stages', f.stage);
    if (f.minSum !== '') qp.set('minSum', f.minSum);
    if (f.maxSum !== '') qp.set('maxSum', f.maxSum);
    const qs = qp.toString();
    [host1, host2, host3, mgrHost].forEach(h => { h.innerHTML = ''; h.append(noData('Загрузка…')); });
    window.__API__.apiFetch('reports/summary' + (qs ? '?' + qs : '')).then(rep => {
    const brand = '#00A6E2';
    const palette = ['#00A6E2','#7B61FF','#FF9F43','#28C76F','#EF4444','#06B6D4'];
    if (window.Chart) {
      Chart.defaults.font.family = "'Inter', sans-serif";
      Chart.defaults.font.size = 12;
      Chart.defaults.color = '#6B7280';
    }

    // 0) Сводка по сделкам + разбивка по этапам (с учётом фильтров)
    updateTaskStats();
    const byStage = rep.byStage || [];
    dealsTotalVal.textContent = String(byStage.reduce((s, x) => s + (x.count || 0), 0));
    stageHost.innerHTML = '';
    if (!byStage.length) {
      stageHost.append(noData('Нет сделок по выбранным фильтрам'));
    } else {
      // Объединяем одинаковые этапы из разных воронок по названию — статистика по всем воронкам
      const grouped = new Map();
      byStage.forEach(x => {
        const stg = STAGES.find(s => s.id === x.stage_id) || { label: x.stage_id, color: '#9CA3AF', sort: 999 };
        const g = grouped.get(stg.label) || { label: stg.label, color: stg.color, sort: stg.sort != null ? stg.sort : 999, count: 0, sum: 0, ids: [] };
        g.count += x.count || 0;
        g.sum += x.sum || 0;
        g.ids.push(x.stage_id);
        if ((stg.sort != null ? stg.sort : 999) < g.sort) g.sort = stg.sort;
        grouped.set(stg.label, g);
      });
      const rows = [...grouped.values()].sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const st = el('table', { class:'data' });
      st.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Этап'), el('th', { class:'num' }, 'Сделок'), el('th', { class:'num' }, 'Сумма')])));
      st.append(el('tbody', {}, rows.map(g => {
        const single = g.ids.length === 1; // один этап → доступен переход к сделкам этого этапа
        return el('tr', single ? {
          style:'cursor:pointer', title:`Открыть сделки этапа «${g.label}»`,
          onclick: () => {
            const stg = STAGES.find(s => s.id === g.ids[0]);
            if (stg && stg.pipelineId) setDealsPipeline(stg.pipelineId);
            DEALS_STAGE = g.ids[0];
            DEALS_MGR = f.manager; DEALS_FROM = f.from; DEALS_TO = f.to; DEALS_Q = '';
            DEALS_VIEW = 'list';
            navigate('deals');
          },
        } : {}, [
          el('td', {}, el('span', { class:'pill', style:`background:${g.color}22;color:${g.color}` }, g.label)),
          el('td', { class:'num strong' }, g.count),
          el('td', { class:'num muted' }, fmtMoneyK(g.sum)),
        ]);
      })));
      stageHost.append(st);
    }

    // 1) Выручка по месяцам
    const months = rep.byMonth || [];
    host1.innerHTML = '';
    if (!window.Chart || !months.length) {
      host1.append(noData(months.length ? 'График недоступен' : 'Нет сделок с датой по выбранным фильтрам'));
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
      host3.append(noData('Нет сделок по выбранным фильтрам'));
    } else {
      const cv3 = el('canvas', { style:'max-height:260px' }); host3.append(cv3);
      new Chart(cv3.getContext('2d'), {
        type: 'bar',
        data: { labels: mgr.map(m => (m.user ? m.user.name.split(' ')[0] : '—')), datasets: [{ label: 'Факт', data: mgr.map(m => Math.round(m.sum / 1e6 * 10) / 10), backgroundColor: brand, borderRadius: 6 }] },
        options: { responsive: true,
          onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          onClick: (e, els) => { if (!els.length) return; const m = mgr[els[0].index]; if (!m || !m.manager_id) return;
            if (f.pipeline) setDealsPipeline(f.pipeline);
            DEALS_MGR = m.manager_id; DEALS_STAGE = ''; DEALS_FROM = f.from; DEALS_TO = f.to; DEALS_Q = '';
            DEALS_VIEW = 'list'; navigate('deals'); },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y + ' млн ₸' } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'млн ₸' } } } },
      });
    }

    // таблица менеджеров — доля от общего факта
    const totalFact = mgr.reduce((s, m) => s + m.sum, 0);
    mgrHost.innerHTML = '';
    if (!mgr.length) {
      mgrHost.append(noData('Нет сделок по выбранным фильтрам'));
    } else {
      const mt = el('table', { class:'data' });
      mt.append(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Менеджер'), el('th', { class:'num' }, 'Сделок'), el('th', { class:'num' }, 'Факт'), el('th', {}, 'Доля'),
      ])));
      mt.append(el('tbody', {}, mgr.map(m => {
        const u = m.user || { name: '—', avatar: '?', color: '#9CA3AF' };
        const pct = totalFact > 0 ? Math.round(m.sum / totalFact * 100) : 0;
        const rowAttrs = m.manager_id
          ? { style:'cursor:pointer', title:`Открыть сделки менеджера ${u.name}`, onclick: () => {
              if (f.pipeline) setDealsPipeline(f.pipeline);     // переносим воронку, если выбрана
              DEALS_MGR = m.manager_id; DEALS_STAGE = ''; DEALS_FROM = f.from; DEALS_TO = f.to; DEALS_Q = '';
              DEALS_VIEW = 'list';
              navigate('deals');
            } }
          : {};
        return el('tr', rowAttrs, [
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
      [host1, host2, host3, mgrHost, stageHost].forEach(h => { h.innerHTML = ''; h.append(noData('Ошибка загрузки аналитики')); });
    });
  }
  loadReports();

  // Динамика: подтягиваем актуальные воронки и этапы из БД (новые воронки/этапы сразу в фильтрах)
  window.__API__.refreshDicts().then(d => {
    STAGES = d.STAGES; PIPELINES = d.PIPELINES;
    rebuildPipes(); rebuildStages();
    loadReports(); // пересчёт статистики по актуальным данным
  }).catch(() => {});

  return wrap;
};

// ============================================================
// VIEW: ARCHIVE (удалённые сделки/клиенты, хранятся 30 дней)
// ============================================================
VIEWS.archive = () => {
  const wrap = el('div');
  wrap.append(el('div', { class:'page-head' }, [
    el('div', {}, [el('h1', {}, 'Архив'), el('div', { class:'sub' }, 'Удалённые сделки, клиенты и счета · хранятся 30 дней, затем удаляются навсегда')]),
  ]));

  // Тулбар: поиск + сортировка по времени удаления
  let ARCH = { deals: [], clients: [], invoices: [] };
  let q = '', sort = 'desc';
  const searchI = el('input', { placeholder:'Поиск в архиве…', oninput: (e) => { q = e.target.value.toLowerCase().trim(); render(); } });
  const sortSel = el('select', { onchange: (e) => { sort = e.target.value; render(); drawer.refreshBadge(); } }, [
    el('option', { value:'desc' }, 'Сначала новые'),
    el('option', { value:'asc' }, 'Сначала старые'),
  ]);
  const drawer = buildFilterDrawer({
    groups: [ filterGroup('Сортировка по времени удаления', sortSel) ],
    onReset: () => { sort = 'desc'; sortSel.value = 'desc'; render(); },
    countActive: () => sort !== 'desc' ? 1 : 0,
  });
  wrap.append(el('div', { class:'table-toolbar', style:'margin-bottom:16px' }, [ searchI, el('div', { style:'margin-left:auto' }, drawer.btn) ]));
  wrap.append(drawer.backdrop, drawer.drawer);

  const host = el('div', {}, el('div', { class:'muted', style:'padding:14px' }, 'Загрузка…'));
  wrap.append(host);

  const daysLeft = (at) => { const ms = 30*24*3600*1000 - (Date.now() - new Date(at).getTime()); return Math.max(0, Math.ceil(ms / (24*3600*1000))); };
  const byTime = (a, b) => { const ta = new Date(a.archived_at || 0).getTime(), tb = new Date(b.archived_at || 0).getTime(); return sort === 'asc' ? ta - tb : tb - ta; };
  async function restore(type, id) {
    try {
      await window.__API__.apiFetch('archive/restore', { method:'POST', body: { type, id } });
      toast(type === 'deal' ? 'Сделка восстановлена' : type === 'client' ? 'Клиент восстановлен' : 'Счёт восстановлен', 'success');
      await loadData(); navigate('archive');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
  }
  function section(cols, rows, emptyText) {
    const tw = el('div', { class:'table-wrap' });
    tw.append(el('table', { class:'data' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, cols.col), el('th', {}, cols.mid), el('th', {}, 'Удалено'), el('th', {}, 'Осталось'), el('th', {}, '')])),
      el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan:5, class:'muted', style:'text-align:center;padding:16px' }, emptyText))]),
    ]));
    return tw;
  }
  function render() {
    const deals = ARCH.deals
      .filter(d => !q || (String(d.title || '') + ' ' + (d.no || '')).toLowerCase().includes(q))
      .slice().sort(byTime);
    const clients = ARCH.clients
      .filter(c => !q || (String(c.name || '') + ' ' + (c.city || '') + ' ' + (c.bin || '')).toLowerCase().includes(q))
      .slice().sort(byTime);
    const invoices = ARCH.invoices
      .filter(iv => { const cl = clientById(iv.client_id); return !q || (String(iv.no || '') + ' ' + (cl ? cl.name : '')).toLowerCase().includes(q); })
      .slice().sort(byTime);
    host.innerHTML = '';
    host.append(el('div', { style:'font-weight:600;margin:8px 0 10px' }, `Сделки в архиве (${deals.length})`));
    host.append(section({ col:'Сделка', mid:'Сумма' }, deals.map(d => el('tr', {}, [
      el('td', { class:'strong' }, d.title || '—'),
      el('td', { class:'num strong' }, fmtMoneyK(d.amount || 0)),
      el('td', { class:'muted' }, d.archived_at ? fmtDate(d.archived_at) : '—'),
      el('td', {}, daysLeft(d.archived_at) + ' дн.'),
      el('td', {}, el('button', { class:'btn btn-sm btn-primary', onclick: () => restore('deal', d.id) }, '↩ Восстановить')),
    ])), q ? 'Ничего не найдено' : 'Архив сделок пуст'));
    host.append(el('div', { style:'font-weight:600;margin:24px 0 10px' }, `Клиенты в архиве (${clients.length})`));
    host.append(section({ col:'Клиент', mid:'Город' }, clients.map(c => el('tr', {}, [
      el('td', { class:'strong' }, c.name || '—'),
      el('td', { class:'muted' }, c.city || '—'),
      el('td', { class:'muted' }, c.archived_at ? fmtDate(c.archived_at) : '—'),
      el('td', {}, daysLeft(c.archived_at) + ' дн.'),
      el('td', {}, el('button', { class:'btn btn-sm btn-primary', onclick: () => restore('client', c.id) }, '↩ Восстановить')),
    ])), q ? 'Ничего не найдено' : 'Архив клиентов пуст'));
    host.append(el('div', { style:'font-weight:600;margin:24px 0 10px' }, `Счета в архиве (${invoices.length})`));
    host.append(section({ col:'№ счёта', mid:'Клиент' }, invoices.map(iv => {
      const cl = clientById(iv.client_id);
      return el('tr', {}, [
        el('td', { class:'strong' }, iv.no || '—'),
        el('td', {}, cl ? cl.name : '—'),
        el('td', { class:'muted' }, iv.archived_at ? fmtDate(iv.archived_at) : '—'),
        el('td', {}, daysLeft(iv.archived_at) + ' дн.'),
        el('td', {}, el('button', { class:'btn btn-sm btn-primary', onclick: () => restore('invoice', iv.id) }, '↩ Восстановить')),
      ]);
    }), q ? 'Ничего не найдено' : 'Архив счетов пуст'));
  }
  window.__API__.apiFetch('archive').then(data => { ARCH = { deals: data.deals || [], clients: data.clients || [], invoices: data.invoices || [] }; render(); })
    .catch(err => { host.innerHTML = ''; host.append(el('div', { class:'pill pill-danger', style:'margin:12px' }, 'Ошибка: ' + ((err && err.message) || err))); });
  return wrap;
};

// Создание новой роли (директор) — появляется колонкой в матрице доступа
function openNewRole() {
  const nameI = el('input', { placeholder: 'Например: Логист' });
  const colorI = el('input', { type: 'color', value: '#6B7280', style: 'width:48px;height:34px;padding:2px' });
  openModal({
    title: 'Новая роль',
    body: el('div', {}, [
      el('div', { class: 'form-row' }, [el('label', {}, 'Название роли'), nameI]),
      el('div', { class: 'form-row' }, [el('label', {}, 'Цвет'), colorI]),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, 'После создания отметьте доступные разделы в матрице и нажмите «Сохранить доступы».'),
    ]),
    foot: [
      el('button', { class: 'btn', onclick: closeModal }, 'Отмена'),
      el('button', { class: 'btn btn-primary', onclick: async (e) => {
        const label = nameI.value.trim();
        if (!label) { nameI.focus(); return; }
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
        const key = (slug || 'role') + '-' + Math.random().toString(36).slice(2, 6);
        const btn = e.currentTarget; btn.disabled = true;
        try {
          await window.__API__.apiFetch('roles', { method: 'POST', body: { key, label, color: colorI.value, modules: '[]', can_edit: '{}', see_all_data: 0 } });
          await loadData(); closeModal(); navigate('settings'); toast('Роль создана', 'success');
        } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); btn.disabled = false; }
      } }, 'Создать'),
    ],
  });
  setTimeout(() => nameI.focus(), 30);
}

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
        !isMe ? el('button', { class:'btn btn-sm', title:'Удалить', onclick: async () => { if (await confirmModal({ title:'Удаление пользователя', message:'Удалить пользователя ' + u.name + '?', confirmText:'Удалить', danger:true })) { try { await window.__API__.apiFetch('users/' + u.id, { method: 'DELETE' }); state.users = state.users.filter(x => x.id !== u.id); toast('Пользователь удалён', 'success'); } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); } navigate('settings'); } } }, '🗑') : null,
      ]) : el('span', { class:'muted' }, '—')),
    ]);
  })));
  card.append(tab);
  wrap.append(card);

  // Статус синхронизации с 1С (выполняется автоматически в фоне)
  if (can('edit-users')) {
    const syncCard = el('div', { class:'card mt-16' });
    syncCard.append(el('div', { class:'card-head' }, el('h3', {}, 'Синхронизация с 1С')));
    syncCard.append(el('div', { class:'muted', style:'font-size:12px;margin-bottom:10px' }, 'Данные подтягиваются из 1С автоматически в фоне: контрагенты ~20 мин, остатки/приходы ~10–20 мин, номенклатура и цены ~20–60 мин. Ручной запуск не требуется.'));
    const statusHost = el('div', { class:'muted', style:'font-size:12px' }, 'Статус: загрузка…');
    syncCard.append(statusHost);
    wrap.append(syncCard);
    window.__API__.apiFetch('sync/status').then(rows => {
      rows = rows || [];
      const f = (e) => rows.find(x => x.entity === e);
      const cl = f('clients_1c'), pr = f('products_1c'), st = f('stock_1c'), px = f('prices_1c'), rc = f('receipts_1c'), ip = f('invoices_push'), sp = f('shipments_push');
      statusHost.innerHTML = '';
      statusHost.append(
        el('div', {}, cl ? `Контрагенты: ${String(cl.last_at).slice(0, 16)} · ${cl.info}` : 'Контрагенты ещё не синхронизировались'),
        el('div', {}, pr ? `Номенклатура: ${String(pr.last_at).slice(0, 16)} · ${pr.info}` : 'Номенклатура ещё не синхронизировалась'),
        el('div', {}, st ? `Остатки: ${String(st.last_at).slice(0, 16)} · ${st.info}` : 'Остатки ещё не синхронизировались'),
        el('div', {}, px ? `Цены: ${String(px.last_at).slice(0, 16)} · ${px.info}` : 'Цены ещё не пересчитывались'),
        el('div', {}, rc ? `Приходы: ${String(rc.last_at).slice(0, 16)} · ${rc.info}` : 'Приходы ещё не синхронизировались'),
        el('div', {}, ip ? `Счета → 1С: ${String(ip.last_at).slice(0, 16)} · ${ip.info}` : 'Счета в 1С ещё не отправлялись'),
        el('div', {}, sp ? `Отгрузки → 1С (списание): ${String(sp.last_at).slice(0, 16)} · ${sp.info}` : 'Отгрузки в 1С ещё не отправлялись (этап 3 выключен)'),
      );
    }).catch(() => { statusHost.textContent = ''; });

    // Переключатель этапа 3 (отгрузки → 1С). Ответственно — влияет на налоги/ЭСФ.
    const shipRow = el('div', { style:'margin-top:14px;padding-top:12px;border-top:1px solid var(--border, #eee)' });
    const shipChk = el('input', { type:'checkbox', disabled:true, style:'width:16px;height:16px;cursor:pointer' });
    const shipLabel = el('label', { style:'display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer' },
      [shipChk, el('span', {}, 'Этап 3: отгрузки → «Реализация» в 1С с проведением (списание склада)')]);
    const shipState = el('span', { class:'muted', style:'font-size:12px;margin-left:8px' }, '');
    shipRow.append(
      shipLabel,
      el('div', { class:'muted', style:'font-size:12px;margin-top:4px' },
        '⚠ Влияет на налоги/ЭСФ. При включении отгрузка создаёт ПРОВЕДЁННУЮ «Реализацию» в 1С — товар списывается со склада автоматически. Включать только после согласования с бухгалтером.'),
      shipState,
    );
    syncCard.append(shipRow);
    window.__API__.apiFetch('sync/flags').then(f => {
      shipChk.checked = !!(f && f.shipments);
      if (f && f.shipments_env_forced) { shipChk.disabled = true; shipState.textContent = 'Управляется переменной окружения ONEC_SHIPMENTS.'; }
      else shipChk.disabled = false;
    }).catch(() => { shipState.textContent = ''; });
    shipChk.onchange = async (e) => {
      const on = e.target.checked; shipChk.disabled = true; shipState.textContent = 'Сохранение…';
      try {
        const r = await window.__API__.apiFetch('sync/flags', { method:'POST', body:{ shipments: on } });
        shipChk.checked = !!(r && r.shipments);
        shipState.textContent = (r && r.shipments) ? 'Включено.' : 'Выключено.';
      } catch (err) { shipChk.checked = !on; shipState.textContent = 'Ошибка: ' + ((err && err.message) || err); }
      finally { shipChk.disabled = false; }
    };

    // Этап 4: очередь отправки в 1С (ретраи) + лог последних попыток.
    const qRow = el('div', { style:'margin-top:14px;padding-top:12px;border-top:1px solid var(--border, #eee)' });
    const qHead = el('div', { style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap' });
    const qTitle = el('div', { style:'font-size:13px;font-weight:600' }, 'Очередь отправки в 1С');
    const qSummary = el('span', { class:'muted', style:'font-size:12px' }, '…');
    const qBtn = el('button', { class:'btn btn-sm', style:'margin-left:auto' }, 'Досыл сейчас');
    qHead.append(qTitle, qSummary, qBtn);
    const qLog = el('div', { class:'muted', style:'font-size:11px;margin-top:8px;max-height:160px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;line-height:1.5' }, '');
    qRow.append(qHead, qLog);
    syncCard.append(qRow);
    const loadQueue = () => window.__API__.apiFetch('sync/queue').then(q => {
      const s = (q && q.summary) || {};
      qSummary.textContent = `в очереди: ${s.pending || 0} · ошибок: ${s.error || 0} · отправлено: ${s.done || 0}`;
      qSummary.style.color = (s.error ? '#dc2626' : (s.pending ? '#d97706' : ''));
      const log = (q && q.log) || [];
      qLog.innerHTML = '';
      if (!log.length) { qLog.textContent = 'Пока нет отправок.'; return; }
      log.forEach(r => {
        const t = String(r.at || '').slice(5, 16);
        const mark = r.ok ? '✓' : '✗';
        const line = el('div', { style: r.ok ? '' : 'color:#dc2626' }, `${t} ${mark} ${r.kind} ${r.ref_id}: ${r.info || ''}`);
        qLog.append(line);
      });
    }).catch(() => { qSummary.textContent = 'недоступно'; });
    qBtn.onclick = async () => {
      qBtn.disabled = true; const o = qBtn.textContent; qBtn.textContent = 'Досылаю…';
      try { const r = await window.__API__.apiFetch('sync/queue', { method:'POST' }); toast(`Обработано: ${r.ok || 0}/${r.processed || 0}`, 'success'); }
      catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
      finally { qBtn.textContent = o; qBtn.disabled = false; loadQueue(); }
    };
    loadQueue();
  }

  // Матрица прав
  const permsCard = el('div', { class:'card mt-16' });
  const ALL_MODULES = [
    ['dashboard','Дашборд'],['deals','Сделки'],['clients','Клиенты'],
    ['catalog','Каталог'],['warehouse','Склад'],['shipments','Отгрузки'],['invoices','Документы'],
    ['suppliers','Поставщики'],['tasks','Задачи'],['reports','Отчёты'],['settings','Настройки'],['archive','Архив'],
  ];
  const CORE_ROLES = ['director', 'manager', 'warehouse', 'accountant'];
  // Колонки — все роли из БД (включая новые), подписи без иконок
  const roleCols = Object.entries(ROLES)
    .sort((a, b) => { const ia = CORE_ROLES.indexOf(a[0]), ib = CORE_ROLES.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); })
    .map(([rk, r]) => [rk, r.label]);
  // черновик доступов (Set модулей по роли) — редактируется только директором
  const draft = {}; roleCols.forEach(([rk]) => { draft[rk] = new Set(ROLES[rk].modules); });

  const saveRolesBtn = canEditUsers ? el('button', { class:'btn btn-sm btn-primary', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; const o = b.textContent; b.textContent = 'Сохранение…';
    try {
      for (const [rk] of roleCols) {
        const mods = ALL_MODULES.map(([k]) => k).filter(k => draft[rk].has(k));
        await window.__API__.apiFetch('roles/' + encodeURIComponent(rk), { method: 'PUT', body: { modules: JSON.stringify(mods) } });
      }
      toast('Доступы по ролям сохранены', 'success');
      await loadData(); navigate('settings');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); b.disabled = false; b.textContent = o; }
  } }, '💾 Сохранить доступы') : null;

  permsCard.append(el('div', { class:'card-head' }, [
    el('h3', {}, 'Матрица доступа по ролям'),
    el('div', { class:'row', style:'gap:8px' }, [
      canEditUsers ? el('button', { class:'btn btn-sm', onclick: openNewRole }, '+ Роль') : null,
      saveRolesBtn,
    ]),
  ]));
  if (canEditUsers) permsCard.append(el('div', { class:'muted', style:'font-size:12px;margin:-6px 4px 10px' }, 'Отметьте, какие разделы видит каждая роль, и нажмите «Сохранить доступы». Раздел «Настройки» у директора зафиксирован.'));

  const pt = el('table', { class:'data role-matrix' });
  pt.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Модуль'),
    ...roleCols.map(([rk, label]) => el('th', { class:'num' },
      (canEditUsers && rk !== currentUser.roleKey)
        ? el('span', { class:'role-head' }, [
            el('span', {}, label),
            el('button', { class:'role-del', title:'Удалить роль', onclick: async () => {
              if (!(await confirmModal({ title:'Удаление роли', message:`Удалить роль «${label}»? Пользователи с этой ролью потеряют доступ.`, confirmText:'Удалить', danger:true }))) return;
              try { await window.__API__.apiFetch('roles/' + encodeURIComponent(rk), { method:'DELETE' }); await loadData(); navigate('settings'); toast('Роль удалена', 'success'); }
              catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
            } }, '×'),
          ])
        : label)),
  ])));
  pt.append(el('tbody', {}, ALL_MODULES.map(([k,label]) => el('tr', {}, [
    el('td', { class:'strong' }, label),
    ...roleCols.map(([rk]) => {
      if (!canEditUsers) {
        const has = draft[rk].has(k);
        return el('td', { class:'num' }, has ? el('span', { style:'color:#10B981;font-size:16px' }, '✓') : el('span', { style:'color:#9CA3AF' }, '—'));
      }
      const lock = (rk === 'director' && k === 'settings'); // защита от самоблокировки
      const cb = el('input', {
        type:'checkbox',
        checked: draft[rk].has(k) ? 'checked' : null,
        disabled: lock ? 'disabled' : null,
        title: lock ? 'Нельзя убрать у директора' : '',
        onchange: (e) => { if (e.target.checked) draft[rk].add(k); else draft[rk].delete(k); },
      });
      return el('td', { class:'num' }, cb);
    }),
  ]))));
  permsCard.append(el('div', { style:'overflow-x:auto' }, pt));
  wrap.append(permsCard);

  // О компании — редактируемые реквизиты (директор сохраняет в БД)
  const m = state.meta || {};
  const cLegal = fInput('Юридическое наименование', m.legalName || '');
  const cTenant = fInput('Бренд (короткое имя)', m.tenant || '');
  const cBin = fInput('БИН', m.bin || '');
  const cCity = fInput('Город', m.city || '');
  const cAddr = fInput('Адрес', m.address || '');
  const cHours = fInput('Время работы', m.workHours || '');
  const cSite = fInput('Сайт', m.website || '');
  const cCurr = fInput('Валюта', m.currency || '₸');
  const cNote = fTextarea('Заметка / статус', m.note || '');
  const cFields = [cLegal, cTenant, cBin, cCity, cAddr, cHours, cSite, cCurr, cNote];
  if (!canEditUsers) cFields.forEach(f => f.row.querySelectorAll('input,textarea').forEach(i => i.disabled = true));

  const saveCompanyBtn = canEditUsers ? el('button', { class:'btn btn-sm btn-primary', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; const o = b.textContent; b.textContent = 'Сохранение…';
    const body = {
      tenant: cTenant.get().trim(), city: cCity.get(), currency: cCurr.get().trim() || '₸',
      legal_name: cLegal.get(), bin: cBin.get(), address: cAddr.get(),
      work_hours: cHours.get(), website: cSite.get(), note: cNote.get(),
    };
    try {
      await window.__API__.apiFetch('company/' + (m.id || 1), { method:'PUT', body });
      Object.assign(state.meta, { tenant: body.tenant, city: body.city, currency: body.currency,
        legalName: body.legal_name, bin: body.bin, address: body.address, workHours: body.work_hours, website: body.website, note: body.note });
      toast('Реквизиты компании сохранены', 'success');
    } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); }
    b.disabled = false; b.textContent = o;
  } }, '💾 Сохранить') : null;

  const info = el('div', { class:'card mt-16' });
  info.append(el('div', { class:'card-head' }, [el('h3', {}, 'О компании'), saveCompanyBtn]));
  info.append(el('div', { style:'padding:4px 4px 0' }, cFields.map(f => f.row)));
  wrap.append(info);

  // Обслуживание: удаление демо/захардкоженных данных (только директор)
  if (currentUser && currentUser.roleKey === 'director') {
    const maint = el('div', { class:'card', style:'margin-top:16px' });
    maint.append(el('div', { class:'card-head' }, el('h3', {}, 'Обслуживание')));
    const clearBtn = el('button', { class:'btn btn-danger btn-sm', onclick: async (e) => {
      const btn = e.currentTarget; // фиксируем до await: после него currentTarget = null
      if (!(await confirmModal({ title:'Удаление демо-данных', message:'Удалить все фиктивные (демо) записи: сделки, клиентов, документы, поставщиков, товары, отгрузки? Данные, синхронизированные из 1С, будут сохранены. Действие необратимо.', confirmText:'Удалить', cancelText:'Отмена', danger:true }))) return;
      const old = btn.textContent; btn.disabled = true; btn.textContent = 'Удаление…';
      try {
        const res = await window.__API__.apiFetch('admin/clear-demo', { method:'POST' });
        const c = (res && res.cleared) || {};
        await loadData();
        toast(`Удалено: сделок ${c.deals||0}, клиентов ${c.clients||0}, счетов ${c.invoices||0}, поставщиков ${c.suppliers||0}, товаров ${c.products||0}, отгрузок ${c.shipments||0}`, 'success');
        navigate('settings');
      } catch (err) { toast('Ошибка: ' + ((err && err.message) || err), 'error'); btn.disabled = false; btn.textContent = old; }
    } }, '🧹 Удалить демо-данные');
    maint.append(el('div', { style:'padding:12px 16px' }, [
      el('div', { class:'muted', style:'font-size:13px;margin-bottom:10px;line-height:1.5' }, 'Удаляет фиктивные записи из исходного наполнения (сделки, клиенты, документы, поставщики, товары, отгрузки). Записи, подтянутые из 1С, не затрагиваются.'),
      clearBtn,
    ]));
    wrap.append(maint);
  }

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
  PIPELINES = dict.PIPELINES || [];
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
    <div class="modal-overlay" id="cmodal" style="z-index:200">
      <div class="modal" style="max-width:460px">
        <div class="modal-head"><h3 id="cmodal-title">—</h3><button id="cmodal-close" aria-label="Закрыть">×</button></div>
        <div class="modal-body" id="cmodal-body"></div>
        <div class="modal-foot" id="cmodal-foot"></div>
      </div>
    </div>
  `;

  // Сайдбар — только разрешённые модули
  const NAV_ITEMS = [
    { v: 'dashboard',  icon: '📊', label: 'Дашборд' },
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
    if (it.v === 'deals') { nav.appendChild(buildDealsNavGroup(it, idx === 0)); return; }
    const btn = el('button', { 'data-view': it.v, class: idx === 0 ? 'active' : '' }, [
      el('span', { class: 'icon' }, it.icon),
      ' ' + it.label,
    ]);
    nav.appendChild(btn);
  });
  // Архив (удалённые сделки/клиенты) — по праву доступа «Архив»
  if (can('see-module', 'archive')) nav.appendChild(el('button', { 'data-view': 'archive' }, [el('span', { class: 'icon' }, '🗄'), ' Архив']));
  refreshPipelineNav();

  // Обработчики
  $('#reset-state').addEventListener('click', async () => {
    if (await confirmModal({ title:'Сброс демо-данных', message:'Сбросить демо-данные? Это вернёт всех пользователей, сделки, клиентов к исходному состоянию.', confirmText:'Сбросить', danger:true })) resetState();
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

  // Первая страница — из URL (#view) либо первая доступная роли
  routeFromHash();

  // Напоминания по задачам: индикатор на колокольчике + тост о просроченных
  const dot = $('#notif-btn .dot');
  if (dot) dot.style.display = (taskReminders().length || (state.notifications || []).length) ? '' : 'none';
  const overdueCount = visibleTasks().filter(t => !t.done && taskDue(t).kind === 'overdue').length;
  if (overdueCount) setTimeout(() => toast(`У вас ${overdueCount} ${plural(overdueCount, 'просроченная задача', 'просроченные задачи', 'просроченных задач')}`, 'warn'), 700);

  // Фоновая авто-синхронизация с 1С, пока CRM открыта у любого сотрудника: запускаем
  // «просроченные» синки. Интервалы соблюдаются на сервере (runDueSyncs по sync_state).
  if (currentUser) {
    if (window.__syncTimer) clearInterval(window.__syncTimer);
    const tick = () => { window.__API__.apiFetch('sync/run', { method: 'POST' }).catch(() => {}); };
    setTimeout(tick, 5000);                       // первый запуск вскоре после входа
    window.__syncTimer = setInterval(tick, 5 * 60 * 1000); // и далее каждые 5 минут
  }
}

// ============================================================
// Init
// ============================================================
startIconObserver();
bootApp();
