// KES CRM — стартовые справочники интерфейса (этапы, роли, типы клиентов).
// Это НЕ данные: реальные сделки/клиенты/товары и актуальные справочники приходят
// из бэкенда (Cloudflare D1) при загрузке. Эти значения нужны только для мгновенной
// отрисовки подписей до прихода данных и сразу заменяются значениями из БД.

(function () {

// Этапы сделок по умолчанию (переопределяются этапами из БД)
const STAGES = [
  { id: 'new',     label: 'Новая',           color: '#9CA3AF' },
  { id: 'kp',      label: 'КП отправлено',   color: '#3B82F6' },
  { id: 'agreed',  label: 'Согласовано',     color: '#8B5CF6' },
  { id: 'invoice', label: 'Счёт выставлен',  color: '#F59E0B' },
  { id: 'paid',    label: 'Оплачено',        color: '#10B981' },
  { id: 'shipped', label: 'Отгружено',       color: '#06B6D4' },
  { id: 'lost',    label: 'Отказ',           color: '#EF4444' },
];

// Роли и права доступа по умолчанию (переопределяются ролями из БД)
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

// Чистим возможные старые локальные данные предыдущих версий
try {
  localStorage.removeItem('kes_crm_state_v1');
  localStorage.removeItem('kes_crm_state_v2');
  localStorage.removeItem('kes_crm_state_v3');
  localStorage.removeItem('kes_session_v1');
} catch (_) {}

window.__KES__ = { STAGES, ROLES, CLIENT_TYPES };

})();
