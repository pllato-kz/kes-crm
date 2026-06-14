// KES CRM — демо-данные. Заполняются в localStorage один раз и редактируются прямо в UI.
// Реалистичные значения: настоящие SKU EKF, казахстанские БИНы (12 цифр), цены в тенге.

(function () {

const SEED = {
  meta: { tenant: 'KazEnergoSnab', city: 'Караганда', currency: '₸', version: 1 },

  users: [
    { id: 'u1', name: 'Павел Ким',         role: 'Менеджер по продажам', roleKey: 'manager',   email: 'pavel@snabenergo.kz',  phone: '+7 702 368 88 04', avatar: 'ПК', color: '#00A6E2', password: 'demo', active: true },
    { id: 'u2', name: 'Айгуль Касенова',   role: 'Менеджер по продажам', roleKey: 'manager',   email: 'aigul@snabenergo.kz',  phone: '+7 701 245 11 23', avatar: 'АК', color: '#7B61FF', password: 'demo', active: true },
    { id: 'u3', name: 'Данияр Сулейменов', role: 'Кладовщик',            roleKey: 'warehouse', email: 'daniyar@snabenergo.kz', phone: '+7 707 812 44 90', avatar: 'ДС', color: '#FF9F43', password: 'demo', active: true },
    { id: 'u4', name: 'Жанна Бектурова',   role: 'Бухгалтер',            roleKey: 'accountant', email: 'zhanna@snabenergo.kz', phone: '+7 705 901 22 17', avatar: 'ЖБ', color: '#28C76F', password: 'demo', active: true },
    { id: 'u5', name: 'Тимур',             role: 'Директор',             roleKey: 'director',  email: 'timur@snabenergo.kz',  phone: '+7 700 100 00 01', avatar: 'Т',  color: '#111',    password: 'demo', active: true },
  ],

  categories: [
    { id: 'c01', name: 'Автоматические выключатели модульные', icon: '⚡', count: 165 },
    { id: 'c02', name: 'Контакторы, пускатели, реле',          icon: '🔄', count: 185 },
    { id: 'c03', name: 'Кабель и провод',                       icon: '🧵', count: 62 },
    { id: 'c04', name: 'Изделия для электромонтажа',           icon: '🔌', count: 122 },
    { id: 'c05', name: 'Комплектующие для электрощитов',       icon: '🧰', count: 116 },
    { id: 'c06', name: 'Розетки и выключатели',                 icon: '⏻', count: 52 },
    { id: 'c07', name: 'Автоматы в литом корпусе до 1600А',    icon: '🟧', count: 50 },
    { id: 'c08', name: 'Автоматизация и управление (АВР)',     icon: '🎛️', count: 44 },
    { id: 'c09', name: 'Инструменты',                            icon: '🔧', count: 44 },
    { id: 'c10', name: 'Щиты распределительные навесные',      icon: '🗄️', count: 20 },
    { id: 'c11', name: 'Кабеленесущие системы',                 icon: '🪜', count: 19 },
    { id: 'c12', name: 'Свет (LED, прожекторы)',                icon: '💡', count: 38 },
    { id: 'c13', name: 'Приборы измерительные',                 icon: '📏', count: 24 },
    { id: 'c14', name: 'Силовые разъёмы',                       icon: '🔗', count: 17 },
    { id: 'c15', name: 'Системы обогрева и защиты от протечек', icon: '🌡️', count: 12 },
    { id: 'c16', name: 'Датчики движения и фотореле',           icon: '📡', count: 14 },
    { id: 'c17', name: 'Кнопки и переключатели',                 icon: '🔘', count: 9 },
    { id: 'c18', name: 'Выключатели нагрузки, рубильники',     icon: '🚦', count: 21 },
    { id: 'c19', name: 'Удлинители, сетевые фильтры',           icon: '🔋', count: 8 },
    { id: 'c20', name: 'Устройства защиты от перенапряжений',   icon: '⚠️', count: 4 },
    { id: 'c21', name: 'Щиты с монтажной панелью',              icon: '📦', count: 10 },
  ],

  products: [],

  clients: [],

  deals: [],

  // Заявки (lead) — пока не сделки
  leads: [
    { id: 'l01', source: 'Сайт',    name: 'Айбек Канатов',    phone: '+7 707 333 44 55', subject: 'Нужен расчёт по кабелю ВВГнг 5×16',   created: '2026-05-27 09:14', status: 'new' },
    { id: 'l02', source: 'Звонок',  name: 'Гульшат Серикова', phone: '+7 701 888 22 11', subject: 'Прайс на освещение для склада',       created: '2026-05-27 10:32', status: 'in-work' },
    { id: 'l03', source: 'WhatsApp', name: 'ТОО «Жанаорда»',   phone: '+7 7212 41 00 99', subject: 'Тендер на щиты ЩРВ-24, 8 шт',          created: '2026-05-26 16:48', status: 'in-work' },
    { id: 'l04', source: 'Сайт',    name: 'Денис Капитонов',  phone: '+7 705 100 33 22', subject: 'Срочно нужны автоматы 25А 3P, 40 шт', created: '2026-05-26 14:10', status: 'converted' },
    { id: 'l05', source: 'Звонок',  name: 'ИП Ыбраев',        phone: '+7 702 700 80 90', subject: 'Розетки Минск, оптом',                created: '2026-05-26 11:05', status: 'new' },
  ],

  suppliers: [],

  tasks: [
    { id: 't01', title: 'Перезвонить АО «КазахмысЭнерго» по доплате',     due: '2026-05-27 14:00', owner: 'u2', deal: 'd001', done: false, priority: 'high' },
    { id: 't02', title: 'Согласовать КП с ТОО «Сарыарка» (д. 0152)',      due: '2026-05-27 16:00', owner: 'u2', deal: 'd005', done: false, priority: 'high' },
    { id: 't03', title: 'Отгрузить заказ ТОО «ШахтерЭнергоСервис»',       due: '2026-05-27 11:00', owner: 'u3', deal: 'd008', done: true,  priority: 'medium' },
    { id: 't04', title: 'Закрыть задолженность ТОО «ДорстройКЗ» (2.15М)', due: '2026-05-28 12:00', owner: 'u4', deal: 'd007', done: false, priority: 'high' },
    { id: 't05', title: 'Подготовить договор для нового клиента (cl14)',  due: '2026-05-28 15:00', owner: 'u4', deal: null,   done: false, priority: 'medium' },
    { id: 't06', title: 'Заказ EKF на июнь — согласовать с Морозовым',    due: '2026-05-29 10:00', owner: 'u5', deal: null,   done: false, priority: 'medium' },
    { id: 't07', title: 'Инвентаризация склада — щиты',                    due: '2026-05-30 09:00', owner: 'u3', deal: null,   done: false, priority: 'low' },
    { id: 't08', title: 'Обработать заявку l01 (Айбек Канатов)',          due: '2026-05-27 12:00', owner: 'u1', deal: null,   done: false, priority: 'medium' },
  ],

  invoices: [],

  shipments: [],

  receipts: [ // приходы на склад от поставщиков
    { id: 'rc01', no: 'ПРХ-0089', supplier: 'sp1', date: '2026-05-20', items: 142, amount: 8200000, status: 'оприходовано', note: 'Месячная партия EKF — автоматы + контакторы + щиты' },
    { id: 'rc02', no: 'ПРХ-0090', supplier: 'sp2', date: '2026-05-22', items: 4200, amount: 2400000, status: 'оприходовано', note: 'Кабель ВВГнг 3×1.5 и 3×2.5' },
    { id: 'rc03', no: 'ПРХ-0091', supplier: 'sp4', date: '2026-05-08', items: 28, amount: 380000, status: 'оприходовано', note: 'Инструмент КВТ — пресс-клещи и стрипперы' },
  ],

  notifications: [
    { id: 'n1', text: 'Просрочка оплаты по СФ-2026-0237 (ТОО ДорстройКЗ, 2.15М ₸)', time: '15 мин назад', type: 'error' },
    { id: 'n2', text: 'Новая заявка с сайта от Айбека Канатова',                    time: '1 ч назад',  type: 'info' },
    { id: 'n3', text: 'Низкий остаток: Автомат ВА47-63 3P 63А (31 шт)',             time: '3 ч назад',  type: 'warn' },
    { id: 'n4', text: 'Поставка EKF на 08.06 подтверждена',                          time: '5 ч назад',  type: 'info' },
  ],
};

// Этикетки этапов сделок
const STAGES = [
  { id: 'new',     label: 'Новая',           color: '#9CA3AF' },
  { id: 'kp',      label: 'КП отправлено',   color: '#3B82F6' },
  { id: 'agreed',  label: 'Согласовано',     color: '#8B5CF6' },
  { id: 'invoice', label: 'Счёт выставлен',  color: '#F59E0B' },
  { id: 'paid',    label: 'Оплачено',        color: '#10B981' },
  { id: 'shipped', label: 'Отгружено',       color: '#06B6D4' },
  { id: 'closed',  label: 'Закрыта',         color: '#22C55E' },
  { id: 'lost',    label: 'Отказ',           color: '#EF4444' },
];

// Роли и права доступа: какие модули показываем + кто может что менять
const ROLES = {
  director: {
    label: 'Директор',
    color: '#111',
    modules: ['dashboard','leads','deals','clients','catalog','warehouse','shipments','invoices','suppliers','tasks','reports','settings'],
    canEdit: { deals: 'all', clients: 'all', products: true, users: true, prices: true, invoices: true },
    seeAllData: true,
  },
  manager: {
    label: 'Менеджер по продажам',
    color: '#00A6E2',
    modules: ['dashboard','leads','deals','clients','catalog','tasks','reports'],
    canEdit: { deals: 'own', clients: 'own', products: false, users: false, prices: false, invoices: false },
    seeAllData: false, // видит только своих клиентов/сделки
  },
  warehouse: {
    label: 'Кладовщик',
    color: '#FF9F43',
    modules: ['dashboard','catalog','warehouse','shipments','tasks'],
    canEdit: { deals: false, clients: false, products: 'stock', users: false, prices: false, invoices: false },
    seeAllData: true,
  },
  accountant: {
    label: 'Бухгалтер',
    color: '#28C76F',
    modules: ['dashboard','clients','invoices','suppliers','reports','tasks'],
    canEdit: { deals: false, clients: 'limited', products: false, users: false, prices: false, invoices: true },
    seeAllData: true,
  },
};

const CLIENT_TYPES = {
  opt:  { label: 'Опт',     color: '#7B61FF' },
  rozn: { label: 'Розница', color: '#10B981' },
  dilr: { label: 'Дилер',   color: '#F59E0B' },
};

// ---------- Хранилище ----------
const STORE_KEY = 'kes_crm_state_v3';
// Подчищаем старые версии чтобы не оставались "хвосты"
try { localStorage.removeItem('kes_crm_state_v1'); localStorage.removeItem('kes_crm_state_v2'); localStorage.removeItem('kes_session_v1'); } catch(_) {}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      localStorage.setItem(STORE_KEY, JSON.stringify(SEED));
      return JSON.parse(JSON.stringify(SEED));
    }
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Не удалось прочитать state, перезаливаю seed', e);
    localStorage.setItem(STORE_KEY, JSON.stringify(SEED));
    return JSON.parse(JSON.stringify(SEED));
  }
}

function saveState(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function resetState() {
  localStorage.removeItem(STORE_KEY);
  location.reload();
}

// ---------- Session ----------
const SESSION_KEY = 'kes_session_v1';
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function setSession(userId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, loginAt: new Date().toISOString() }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

window.__KES__ = { SEED, STAGES, ROLES, CLIENT_TYPES, loadState, saveState, resetState, getSession, setSession, clearSession };

})();
