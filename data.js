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

  products: [
    // Автоматы EKF
    { id: 'p001', sku: 'mcb4763-1-16C-pro', name: 'Автомат ВА47-63 1P 16А C 4.5кА EKF PROxima', cat: 'c01', brand: 'EKF', unit: 'шт', priceCost: 920, priceWholesale: 1180, priceRetail: 1490, stock: 142, reserved: 24 },
    { id: 'p002', sku: 'mcb4763-1-25C-pro', name: 'Автомат ВА47-63 1P 25А C 4.5кА EKF PROxima', cat: 'c01', brand: 'EKF', unit: 'шт', priceCost: 950, priceWholesale: 1220, priceRetail: 1540, stock: 88,  reserved: 12 },
    { id: 'p003', sku: 'mcb4763-3-32C-pro', name: 'Автомат ВА47-63 3P 32А C 4.5кА EKF PROxima', cat: 'c01', brand: 'EKF', unit: 'шт', priceCost: 2650, priceWholesale: 3200, priceRetail: 3950, stock: 64, reserved: 8 },
    { id: 'p004', sku: 'mcb4763-3-63C-pro', name: 'Автомат ВА47-63 3P 63А C 6кА EKF PROxima',   cat: 'c01', brand: 'EKF', unit: 'шт', priceCost: 3120, priceWholesale: 3850, priceRetail: 4690, stock: 31, reserved: 3 },
    { id: 'p005', sku: 'mcb4729-1-10C',     name: 'Автомат ВА47-29 1P 10А C 4.5кА EKF Basic',   cat: 'c01', brand: 'EKF', unit: 'шт', priceCost: 480,  priceWholesale: 620,  priceRetail: 790,  stock: 320, reserved: 40 },
    // Контакторы
    { id: 'p101', sku: 'ctr-12A-230',  name: 'Контактор КМЭ 12А 230В 1NO EKF Basic',           cat: 'c02', brand: 'EKF', unit: 'шт', priceCost: 2900,  priceWholesale: 3650,  priceRetail: 4500,  stock: 45, reserved: 6 },
    { id: 'p102', sku: 'ctr-25A-230',  name: 'Контактор КМЭ 25А 230В 1NO EKF Basic',           cat: 'c02', brand: 'EKF', unit: 'шт', priceCost: 3850,  priceWholesale: 4750,  priceRetail: 5890,  stock: 28, reserved: 2 },
    { id: 'p103', sku: 'rel-rly-110',  name: 'Реле промежуточное РЭК77/3 10А 220В EKF',         cat: 'c02', brand: 'EKF', unit: 'шт', priceCost: 1450,  priceWholesale: 1820,  priceRetail: 2290,  stock: 110, reserved: 14 },
    // Кабель
    { id: 'p201', sku: 'cab-vvgng-3x1.5', name: 'Кабель ВВГнг-LS 3×1.5 (ГОСТ)',                cat: 'c03', brand: 'KazКабель', unit: 'м',  priceCost: 220,  priceWholesale: 280,  priceRetail: 340,  stock: 4200, reserved: 800 },
    { id: 'p202', sku: 'cab-vvgng-3x2.5', name: 'Кабель ВВГнг-LS 3×2.5 (ГОСТ)',                cat: 'c03', brand: 'KazКабель', unit: 'м',  priceCost: 340,  priceWholesale: 420,  priceRetail: 520,  stock: 3800, reserved: 1200 },
    { id: 'p203', sku: 'cab-vvgng-5x6',   name: 'Кабель ВВГнг-LS 5×6 (ГОСТ)',                  cat: 'c03', brand: 'KazКабель', unit: 'м',  priceCost: 1620, priceWholesale: 1980, priceRetail: 2390, stock: 950, reserved: 220 },
    { id: 'p204', sku: 'cab-pvs-2x1.5',   name: 'Провод ПВС 2×1.5',                            cat: 'c03', brand: 'KazКабель', unit: 'м',  priceCost: 180,  priceWholesale: 230,  priceRetail: 290,  stock: 2400, reserved: 150 },
    // Изделия для электромонтажа
    { id: 'p301', sku: 'em-box-67mm',    name: 'Подрозетник в гипсокартон D67 глубокий',       cat: 'c04', brand: 'EKF', unit: 'шт', priceCost: 95,   priceWholesale: 130,  priceRetail: 170,  stock: 980, reserved: 110 },
    { id: 'p302', sku: 'em-wago-222-3',  name: 'Клемма WAGO 222-413 3×2.5мм²',                  cat: 'c04', brand: 'WAGO', unit: 'шт', priceCost: 145,  priceWholesale: 195,  priceRetail: 250,  stock: 1200, reserved: 60 },
    { id: 'p303', sku: 'em-corr-20',     name: 'Гофра ПВХ Ø20 с зондом (бухта 50м)',           cat: 'c04', brand: 'EKF', unit: 'м',  priceCost: 42,   priceWholesale: 58,   priceRetail: 75,   stock: 5400, reserved: 800 },
    // Щиты
    { id: 'p401', sku: 'shch-shchn-12',  name: 'Щит навесной ЩРН-П 12 модулей IP41 EKF',       cat: 'c10', brand: 'EKF', unit: 'шт', priceCost: 4900, priceWholesale: 6100, priceRetail: 7490, stock: 38, reserved: 5 },
    { id: 'p402', sku: 'shch-shchv-24',  name: 'Щит встраиваемый ЩРВ-П 24 модуля IP41 EKF',    cat: 'c10', brand: 'EKF', unit: 'шт', priceCost: 8200, priceWholesale: 9900, priceRetail: 11990, stock: 17, reserved: 2 },
    // Розетки
    { id: 'p501', sku: 'sok-mn-1',       name: 'Розетка с/у с заземлением серия Минск белая',  cat: 'c06', brand: 'EKF Минск', unit: 'шт', priceCost: 320, priceWholesale: 420, priceRetail: 540, stock: 480, reserved: 36 },
    { id: 'p502', sku: 'sok-mn-2',       name: 'Выключатель 1-кл серия Минск белый',           cat: 'c06', brand: 'EKF Минск', unit: 'шт', priceCost: 290, priceWholesale: 370, priceRetail: 470, stock: 520, reserved: 28 },
    // Свет
    { id: 'p601', sku: 'led-pnl-36w',    name: 'Светильник LED панель 36Вт 4000K 595×595',     cat: 'c12', brand: 'EKF', unit: 'шт', priceCost: 4200, priceWholesale: 5200, priceRetail: 6490, stock: 92, reserved: 18 },
    { id: 'p602', sku: 'led-pr-100',     name: 'Прожектор LED 100Вт 6500K IP65',                cat: 'c12', brand: 'EKF', unit: 'шт', priceCost: 5800, priceWholesale: 7200, priceRetail: 8990, stock: 44, reserved: 6 },
    // Инструмент
    { id: 'p701', sku: 'tool-strip',     name: 'Стриппер для зачистки кабеля КВТ WS-04A',       cat: 'c09', brand: 'КВТ', unit: 'шт', priceCost: 3200, priceWholesale: 4100, priceRetail: 5290, stock: 22, reserved: 3 },
    { id: 'p702', sku: 'tool-press',     name: 'Пресс-клещи ПК-16 для НШВИ КВТ',                cat: 'c09', brand: 'КВТ', unit: 'шт', priceCost: 8400, priceWholesale: 10200, priceRetail: 12490, stock: 11, reserved: 1 },
    // Измерения
    { id: 'p801', sku: 'meas-multi-uni', name: 'Мультиметр цифровой Mastech MS8233E',           cat: 'c13', brand: 'Mastech', unit: 'шт', priceCost: 6900, priceWholesale: 8400, priceRetail: 10490, stock: 16, reserved: 2 },
    // Силовые разъёмы
    { id: 'p901', sku: 'plug-32-3p',     name: 'Разъём силовой 3P+E 32A IP44 розетка стац.',    cat: 'c14', brand: 'EKF', unit: 'шт', priceCost: 1850, priceWholesale: 2350, priceRetail: 2890, stock: 56, reserved: 4 },
  ],

  clients: [
    { id: 'cl01', name: 'ТОО «КарагандыРемСтрой»',        bin: '180440012345', type: 'opt',    contact: 'Бакыт Алимов',     phone: '+7 701 234 56 78', email: 'b.alimov@krs.kz',     city: 'Караганда', address: 'пр. Бухар Жырау, 49', manager: 'u1', balance: -1240000, ltv: 18500000, lastDeal: '2026-05-20', tags: ['постоянный','стройка'] },
    { id: 'cl02', name: 'ИП Серикбаев Н.К.',               bin: '850712301234', type: 'rozn',   contact: 'Нурлан Серикбаев', phone: '+7 707 812 33 44', email: 'serikbaev@mail.ru',    city: 'Караганда', address: 'мкр. Степной-4, 12-15', manager: 'u1', balance: 0,        ltv: 480000,    lastDeal: '2026-05-18', tags: ['розница'] },
    { id: 'cl03', name: 'АО «КазахмысЭнерго»',             bin: '050940005678', type: 'opt',    contact: 'Елена Прохорова',  phone: '+7 7212 56 12 00', email: 'e.prohorova@kazmin.kz', city: 'Жезказган', address: 'ул. Сатпаева, 1', manager: 'u2', balance: -4800000, ltv: 62000000, lastDeal: '2026-05-25', tags: ['ключевой','тендер'] },
    { id: 'cl04', name: 'ТОО «АстанаЭлектроМонтаж»',       bin: '120640098765', type: 'opt',    contact: 'Тимур Жакупов',    phone: '+7 705 901 22 11', email: 't.zhakupov@aem.kz',   city: 'Астана',    address: 'пр. Кабанбай батыра, 17', manager: 'u2', balance: 0,        ltv: 9200000,  lastDeal: '2026-05-15', tags: ['монтажник'] },
    { id: 'cl05', name: 'ТОО «ТемиртауМашСервис»',         bin: '090340051234', type: 'opt',    contact: 'Сергей Иванов',    phone: '+7 702 100 50 11', email: 's.ivanov@tms.kz',     city: 'Темиртау',  address: 'пр. Республики, 32', manager: 'u1', balance: -380000,  ltv: 5400000,  lastDeal: '2026-05-22', tags: ['промышленность'] },
    { id: 'cl06', name: 'ТОО «БалхашЦветМет»',             bin: '030240076543', type: 'opt',    contact: 'Айдос Сариев',     phone: '+7 7036 22 11 33', email: 'a.sariev@bcm.kz',     city: 'Балхаш',    address: 'ул. Ленина, 8', manager: 'u2', balance: 0,         ltv: 14200000, lastDeal: '2026-04-30', tags: ['ключевой','промышленность'] },
    { id: 'cl07', name: 'ИП Шаймуратов А.К.',              bin: '780923301122', type: 'rozn',   contact: 'Айдар Шаймуратов', phone: '+7 708 444 22 11', email: '—',                  city: 'Караганда', address: 'ул. Гоголя, 41', manager: 'u1', balance: 0,         ltv: 220000,   lastDeal: '2026-05-12', tags: ['розница'] },
    { id: 'cl08', name: 'ТОО «СарыаркаДевелопмент»',       bin: '160340022334', type: 'opt',    contact: 'Гульнара Ахметова', phone: '+7 700 333 77 88', email: 'g.ahmetova@sd.kz',   city: 'Караганда', address: 'пр. Назарбаева, 110', manager: 'u2', balance: -920000,  ltv: 7800000,  lastDeal: '2026-05-24', tags: ['застройщик'] },
    { id: 'cl09', name: 'ТОО «ШахтерЭнергоСервис»',        bin: '110540065432', type: 'opt',    contact: 'Виктор Шмидт',     phone: '+7 7212 41 22 55', email: 'v.shmidt@ses.kz',    city: 'Шахтинск',  address: 'ул. 40 лет Победы, 5', manager: 'u1', balance: 0,        ltv: 3100000,  lastDeal: '2026-05-19', tags: ['монтажник'] },
    { id: 'cl10', name: 'ТОО «АктауСтройМонтаж»',          bin: '140940099887', type: 'opt',    contact: 'Ерлан Калиев',     phone: '+7 705 555 11 22', email: 'kaliev@asm.kz',       city: 'Актау',     address: 'мкр. 1, дом 50', manager: 'u2', balance: 0,        ltv: 2200000,  lastDeal: '2026-04-18', tags: ['монтажник','удалённый'] },
    { id: 'cl11', name: 'ТОО «ДорстройКЗ»',                bin: '190140033445', type: 'opt',    contact: 'Олег Кравченко',    phone: '+7 702 800 12 34', email: 'o.kravchenko@dskz.kz', city: 'Караганда', address: 'ул. Промышленная, 7', manager: 'u1', balance: -2150000, ltv: 6700000,  lastDeal: '2026-05-26', tags: ['постоянный'] },
    { id: 'cl12', name: 'ИП Жумабекова Г.С.',              bin: '910415401234', type: 'rozn',   contact: 'Гульмира Жумабекова', phone: '+7 707 222 88 99', email: '—',                city: 'Караганда', address: 'ул. Ермекова, 60', manager: 'u1', balance: 0,        ltv: 95000,    lastDeal: '2026-05-10', tags: ['розница'] },
    { id: 'cl13', name: 'ТОО «КарагандыНефтеТранс»',       bin: '070240088991', type: 'opt',    contact: 'Марат Турсунов',    phone: '+7 7212 99 11 22', email: 'm.tursunov@knt.kz',  city: 'Караганда', address: 'промзона Юго-Восток', manager: 'u2', balance: 0,        ltv: 11500000, lastDeal: '2026-05-05', tags: ['промышленность'] },
    { id: 'cl14', name: 'ТОО «ЭкоПромРесурс»',             bin: '210640012398', type: 'opt',    contact: 'Дмитрий Лазарев',   phone: '+7 701 700 50 50', email: 'd.lazarev@epr.kz',   city: 'Темиртау',  address: 'пр. Мира, 88', manager: 'u1', balance: -180000,  ltv: 1900000, lastDeal: '2026-05-21', tags: ['новый'] },
    { id: 'cl15', name: 'ТОО «АлматыЭлектро»',             bin: '050840045678', type: 'dilr',   contact: 'Аскар Бекжанов',    phone: '+7 727 250 33 44', email: 'a.bekzhanov@ae.kz',  city: 'Алматы',    address: 'ул. Райымбека, 250', manager: 'u2', balance: 0,        ltv: 28000000, lastDeal: '2026-05-23', tags: ['ключевой','дилер'] },
  ],

  deals: [
    { id: 'd001', no: '2026-0148', client: 'cl03', manager: 'u2', stage: 'shipped',   amount: 4820000, items: 12, created: '2026-05-10', target: '2026-05-30', title: 'Поставка автоматов ВА47-63 на ПС-110',
      lineItems: [
        { product: 'p001', qty: 80,  priceUsed: 1180 },
        { product: 'p003', qty: 40,  priceUsed: 3200 },
        { product: 'p004', qty: 20,  priceUsed: 3850 },
        { product: 'p103', qty: 60,  priceUsed: 1820 },
        { product: 'p202', qty: 300, priceUsed: 420  },
        { product: 'p401', qty: 30,  priceUsed: 6100 },
      ],
    },
    { id: 'd002', no: '2026-0149', client: 'cl01', manager: 'u1', stage: 'paid',      amount: 1245000, items: 8,  created: '2026-05-12', target: '2026-05-28', title: 'Кабель ВВГнг 3×2.5 для ЖК Восточный' },
    { id: 'd003', no: '2026-0150', client: 'cl15', manager: 'u2', stage: 'invoice',   amount: 8900000, items: 24, created: '2026-05-14', target: '2026-06-05', title: 'Дилерская поставка май — освещение + щиты' },
    { id: 'd004', no: '2026-0151', client: 'cl04', manager: 'u2', stage: 'agreed',    amount: 1820000, items: 15, created: '2026-05-15', target: '2026-06-01', title: 'Электромонтажные изделия для офиса' },
    { id: 'd005', no: '2026-0152', client: 'cl08', manager: 'u2', stage: 'kp',        amount: 3450000, items: 18, created: '2026-05-18', target: '2026-06-10', title: 'Щиты ЩРВ-П на 3 секции ЖК «Сарыарка»' },
    { id: 'd006', no: '2026-0153', client: 'cl05', manager: 'u1', stage: 'new',       amount: 680000,  items: 4,  created: '2026-05-22', target: '2026-06-15', title: 'Контакторы и реле для линии №3' },
    { id: 'd007', no: '2026-0154', client: 'cl11', manager: 'u1', stage: 'paid',      amount: 2150000, items: 11, created: '2026-05-20', target: '2026-06-03', title: 'Прожекторы LED 100Вт + кабель' },
    { id: 'd008', no: '2026-0155', client: 'cl09', manager: 'u1', stage: 'shipped',   amount: 760000,  items: 6,  created: '2026-05-13', target: '2026-05-25', title: 'Розетки серия Минск + подрозетники' },
    { id: 'd009', no: '2026-0156', client: 'cl06', manager: 'u2', stage: 'closed',    amount: 5400000, items: 22, created: '2026-04-25', target: '2026-05-20', title: 'Силовая сборка для обогатительной фабрики' },
    { id: 'd010', no: '2026-0157', client: 'cl14', manager: 'u1', stage: 'kp',        amount: 320000,  items: 3,  created: '2026-05-21', target: '2026-06-04', title: 'Стартовый заказ — инструмент и измерения' },
    { id: 'd011', no: '2026-0158', client: 'cl13', manager: 'u2', stage: 'lost',      amount: 1100000, items: 7,  created: '2026-05-02', target: '2026-05-15', title: 'Кабеленесущие системы — отдали конкуренту' },
    { id: 'd012', no: '2026-0159', client: 'cl02', manager: 'u1', stage: 'new',       amount: 145000,  items: 5,  created: '2026-05-26', target: '2026-06-02', title: 'Розничный заказ — мелочи для ремонта' },
  ],

  // Заявки (lead) — пока не сделки
  leads: [
    { id: 'l01', source: 'Сайт',    name: 'Айбек Канатов',    phone: '+7 707 333 44 55', subject: 'Нужен расчёт по кабелю ВВГнг 5×16',   created: '2026-05-27 09:14', status: 'new' },
    { id: 'l02', source: 'Звонок',  name: 'Гульшат Серикова', phone: '+7 701 888 22 11', subject: 'Прайс на освещение для склада',       created: '2026-05-27 10:32', status: 'in-work' },
    { id: 'l03', source: 'WhatsApp', name: 'ТОО «Жанаорда»',   phone: '+7 7212 41 00 99', subject: 'Тендер на щиты ЩРВ-24, 8 шт',          created: '2026-05-26 16:48', status: 'in-work' },
    { id: 'l04', source: 'Сайт',    name: 'Денис Капитонов',  phone: '+7 705 100 33 22', subject: 'Срочно нужны автоматы 25А 3P, 40 шт', created: '2026-05-26 14:10', status: 'converted' },
    { id: 'l05', source: 'Звонок',  name: 'ИП Ыбраев',        phone: '+7 702 700 80 90', subject: 'Розетки Минск, оптом',                created: '2026-05-26 11:05', status: 'new' },
  ],

  suppliers: [
    { id: 'sp1', name: 'EKF Group (РФ)', contact: 'Алексей Морозов',  phone: '+7 495 644 14 16', email: 'morozov@ekfgroup.com', share: 78, lastDelivery: '2026-05-20', note: 'Главный партнёр, субдилерский договор с 2018' },
    { id: 'sp2', name: 'KazКабель ТОО',   contact: 'Ермек Жунусов',    phone: '+7 727 250 12 12', email: 'zhunusov@kazkabel.kz', share: 14, lastDelivery: '2026-05-22', note: 'Кабельная продукция местного производства' },
    { id: 'sp3', name: 'WAGO Россия',     contact: 'Ирина Петрова',    phone: '+7 812 333 22 11', email: 'i.petrova@wago.com',   share: 4,  lastDelivery: '2026-04-18', note: 'Клеммы WAGO под спецзаказ' },
    { id: 'sp4', name: 'КВТ Инструмент',  contact: 'Михаил Селиванов', phone: '+7 495 728 92 50', email: 'sale@kvt.su',          share: 3,  lastDelivery: '2026-05-08', note: 'Профессиональный инструмент' },
    { id: 'sp5', name: 'Mastech KZ',      contact: 'Олег Лукин',       phone: '+7 727 311 22 33', email: 'lukin@mastech.kz',     share: 1,  lastDelivery: '2026-03-25', note: 'Измерительный инструмент' },
  ],

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

  invoices: [
    { id: 'iv01', no: 'СФ-2026-0234', deal: 'd001', client: 'cl03', date: '2026-05-15', amount: 4820000, status: 'paid',    due: '2026-05-25' },
    { id: 'iv02', no: 'СФ-2026-0235', deal: 'd002', client: 'cl01', date: '2026-05-16', amount: 1245000, status: 'paid',    due: '2026-05-26' },
    { id: 'iv03', no: 'СФ-2026-0236', deal: 'd003', client: 'cl15', date: '2026-05-20', amount: 8900000, status: 'pending', due: '2026-06-05' },
    { id: 'iv04', no: 'СФ-2026-0237', deal: 'd007', client: 'cl11', date: '2026-05-22', amount: 2150000, status: 'overdue', due: '2026-05-24' },
    { id: 'iv05', no: 'СФ-2026-0238', deal: 'd008', client: 'cl09', date: '2026-05-18', amount: 760000,  status: 'paid',    due: '2026-05-23' },
    { id: 'iv06', no: 'СФ-2026-0239', deal: 'd009', client: 'cl06', date: '2026-04-28', amount: 5400000, status: 'paid',    due: '2026-05-15' },
  ],

  shipments: [
    { id: 'sh01', no: 'ТТН-0512', deal: 'd001', client: 'cl03', date: '2026-05-21', items: 12, weight: 320, transport: 'Газель собственная', driver: 'Куаныш А.', status: 'delivered',  destination: 'Жезказган, ул. Сатпаева, 1' },
    { id: 'sh02', no: 'ТТН-0513', deal: 'd002', client: 'cl01', date: '2026-05-22', items: 8,  weight: 540, transport: 'Самовывоз',         driver: '—',         status: 'delivered',  destination: 'Караганда, склад клиента' },
    { id: 'sh03', no: 'ТТН-0514', deal: 'd008', client: 'cl09', date: '2026-05-23', items: 6,  weight: 28,  transport: 'Газель собственная', driver: 'Куаныш А.', status: 'delivered',  destination: 'Шахтинск, ул. 40 лет Победы, 5' },
    { id: 'sh04', no: 'ТТН-0515', deal: 'd007', client: 'cl11', date: '2026-05-28', items: 11, weight: 180, transport: 'Транспортная Astana Trans', driver: '—', status: 'planned',   destination: 'Караганда, ул. Промышленная, 7' },
  ],

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
