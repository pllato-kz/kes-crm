-- KES CRM — начальные данные (seed). Сгенерировано из data.js (SEED).
-- Справочники + демо-данные. Пароли всех пользователей: demo
PRAGMA foreign_keys = ON;

-- company
INSERT INTO company (id,tenant,city,currency) VALUES (1,'KazEnergoSnab','Караганда','₸');

-- roles
INSERT INTO roles (key,label,color,modules,can_edit,see_all_data) VALUES ('director','Директор','#111','["dashboard","leads","deals","clients","catalog","warehouse","shipments","invoices","suppliers","tasks","reports","settings"]','{"deals":"all","clients":"all","products":true,"users":true,"prices":true,"invoices":true}',1);
INSERT INTO roles (key,label,color,modules,can_edit,see_all_data) VALUES ('manager','Менеджер по продажам','#00A6E2','["dashboard","leads","deals","clients","catalog","tasks","reports"]','{"deals":"own","clients":"own","products":false,"users":false,"prices":false,"invoices":false}',0);
INSERT INTO roles (key,label,color,modules,can_edit,see_all_data) VALUES ('warehouse','Кладовщик','#FF9F43','["dashboard","catalog","warehouse","shipments","tasks"]','{"deals":false,"clients":false,"products":"stock","users":false,"prices":false,"invoices":false}',1);
INSERT INTO roles (key,label,color,modules,can_edit,see_all_data) VALUES ('accountant','Бухгалтер','#28C76F','["dashboard","clients","invoices","suppliers","reports","tasks"]','{"deals":false,"clients":"limited","products":false,"users":false,"prices":false,"invoices":true}',1);

-- deal_stages
INSERT INTO deal_stages (id,label,color,sort) VALUES ('new','Новая','#9CA3AF',0);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('kp','КП отправлено','#3B82F6',1);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('agreed','Согласовано','#8B5CF6',2);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('invoice','Счёт выставлен','#F59E0B',3);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('paid','Оплачено','#10B981',4);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('shipped','Отгружено','#06B6D4',5);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('closed','Закрыта','#22C55E',6);
INSERT INTO deal_stages (id,label,color,sort) VALUES ('lost','Отказ','#EF4444',7);

-- client_types
INSERT INTO client_types (key,label,color) VALUES ('opt','Опт','#7B61FF');
INSERT INTO client_types (key,label,color) VALUES ('rozn','Розница','#10B981');
INSERT INTO client_types (key,label,color) VALUES ('dilr','Дилер','#F59E0B');

-- product_categories
INSERT INTO product_categories (id,name,icon) VALUES ('c01','Автоматические выключатели модульные','⚡');
INSERT INTO product_categories (id,name,icon) VALUES ('c02','Контакторы, пускатели, реле','🔄');
INSERT INTO product_categories (id,name,icon) VALUES ('c03','Кабель и провод','🧵');
INSERT INTO product_categories (id,name,icon) VALUES ('c04','Изделия для электромонтажа','🔌');
INSERT INTO product_categories (id,name,icon) VALUES ('c05','Комплектующие для электрощитов','🧰');
INSERT INTO product_categories (id,name,icon) VALUES ('c06','Розетки и выключатели','⏻');
INSERT INTO product_categories (id,name,icon) VALUES ('c07','Автоматы в литом корпусе до 1600А','🟧');
INSERT INTO product_categories (id,name,icon) VALUES ('c08','Автоматизация и управление (АВР)','🎛️');
INSERT INTO product_categories (id,name,icon) VALUES ('c09','Инструменты','🔧');
INSERT INTO product_categories (id,name,icon) VALUES ('c10','Щиты распределительные навесные','🗄️');
INSERT INTO product_categories (id,name,icon) VALUES ('c11','Кабеленесущие системы','🪜');
INSERT INTO product_categories (id,name,icon) VALUES ('c12','Свет (LED, прожекторы)','💡');
INSERT INTO product_categories (id,name,icon) VALUES ('c13','Приборы измерительные','📏');
INSERT INTO product_categories (id,name,icon) VALUES ('c14','Силовые разъёмы','🔗');
INSERT INTO product_categories (id,name,icon) VALUES ('c15','Системы обогрева и защиты от протечек','🌡️');
INSERT INTO product_categories (id,name,icon) VALUES ('c16','Датчики движения и фотореле','📡');
INSERT INTO product_categories (id,name,icon) VALUES ('c17','Кнопки и переключатели','🔘');
INSERT INTO product_categories (id,name,icon) VALUES ('c18','Выключатели нагрузки, рубильники','🚦');
INSERT INTO product_categories (id,name,icon) VALUES ('c19','Удлинители, сетевые фильтры','🔋');
INSERT INTO product_categories (id,name,icon) VALUES ('c20','Устройства защиты от перенапряжений','⚠️');
INSERT INTO product_categories (id,name,icon) VALUES ('c21','Щиты с монтажной панелью','📦');

-- warehouses
INSERT INTO warehouses (id,name,city,address) VALUES ('w1','Главный склад','Караганда','');

-- lead_sources
INSERT INTO lead_sources (id,name) VALUES (1,'Сайт');
INSERT INTO lead_sources (id,name) VALUES (2,'Звонок');
INSERT INTO lead_sources (id,name) VALUES (3,'WhatsApp');

-- lead_statuses
INSERT INTO lead_statuses (id,label) VALUES ('new','Новая');
INSERT INTO lead_statuses (id,label) VALUES ('in-work','В работе');
INSERT INTO lead_statuses (id,label) VALUES ('converted','Сконвертирована');

-- shipment_statuses
INSERT INTO shipment_statuses (id,label,color) VALUES ('delivered','Доставлена','#22C55E');
INSERT INTO shipment_statuses (id,label,color) VALUES ('planned','Запланирована','#F59E0B');

-- invoice_statuses
INSERT INTO invoice_statuses (id,label,color) VALUES ('paid','Оплачен','#22C55E');
INSERT INTO invoice_statuses (id,label,color) VALUES ('pending','Ожидает','#F59E0B');
INSERT INTO invoice_statuses (id,label,color) VALUES ('overdue','Просрочен','#EF4444');

-- task_priorities
INSERT INTO task_priorities (id,label,color,sort) VALUES ('high','Высокий','#EF4444',0);
INSERT INTO task_priorities (id,label,color,sort) VALUES ('medium','Средний','#F59E0B',1);
INSERT INTO task_priorities (id,label,color,sort) VALUES ('low','Низкий','#9CA3AF',2);

-- users (пароль у всех: demo)
INSERT INTO users (id,name,email,password_hash,role_key,phone,avatar,color,active) VALUES ('u1','Павел Ким','pavel@snabenergo.kz',NULL,'manager','+7 702 368 88 04','ПК','#00A6E2',1);
INSERT INTO users (id,name,email,password_hash,role_key,phone,avatar,color,active) VALUES ('u2','Айгуль Касенова','aigul@snabenergo.kz',NULL,'manager','+7 701 245 11 23','АК','#7B61FF',1);
INSERT INTO users (id,name,email,password_hash,role_key,phone,avatar,color,active) VALUES ('u3','Данияр Сулейменов','daniyar@snabenergo.kz',NULL,'warehouse','+7 707 812 44 90','ДС','#FF9F43',1);
INSERT INTO users (id,name,email,password_hash,role_key,phone,avatar,color,active) VALUES ('u4','Жанна Бектурова','zhanna@snabenergo.kz',NULL,'accountant','+7 705 901 22 17','ЖБ','#28C76F',1);
INSERT INTO users (id,name,email,password_hash,role_key,phone,avatar,color,active) VALUES ('u5','Тимур','timur@snabenergo.kz',NULL,'director','+7 700 100 00 01','Т','#111',1);

-- suppliers
INSERT INTO suppliers (id,name,contact,phone,email,share,last_delivery,note) VALUES ('sp1','EKF Group (РФ)','Алексей Морозов','+7 495 644 14 16','morozov@ekfgroup.com',78,'2026-05-20','Главный партнёр, субдилерский договор с 2018');
INSERT INTO suppliers (id,name,contact,phone,email,share,last_delivery,note) VALUES ('sp2','KazКабель ТОО','Ермек Жунусов','+7 727 250 12 12','zhunusov@kazkabel.kz',14,'2026-05-22','Кабельная продукция местного производства');
INSERT INTO suppliers (id,name,contact,phone,email,share,last_delivery,note) VALUES ('sp3','WAGO Россия','Ирина Петрова','+7 812 333 22 11','i.petrova@wago.com',4,'2026-04-18','Клеммы WAGO под спецзаказ');
INSERT INTO suppliers (id,name,contact,phone,email,share,last_delivery,note) VALUES ('sp4','КВТ Инструмент','Михаил Селиванов','+7 495 728 92 50','sale@kvt.su',3,'2026-05-08','Профессиональный инструмент');
INSERT INTO suppliers (id,name,contact,phone,email,share,last_delivery,note) VALUES ('sp5','Mastech KZ','Олег Лукин','+7 727 311 22 33','lukin@mastech.kz',1,'2026-03-25','Измерительный инструмент');

-- products
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p001','mcb4763-1-16C-pro','Автомат ВА47-63 1P 16А C 4.5кА EKF PROxima','c01','EKF','шт',920,1180,1490);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p002','mcb4763-1-25C-pro','Автомат ВА47-63 1P 25А C 4.5кА EKF PROxima','c01','EKF','шт',950,1220,1540);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p003','mcb4763-3-32C-pro','Автомат ВА47-63 3P 32А C 4.5кА EKF PROxima','c01','EKF','шт',2650,3200,3950);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p004','mcb4763-3-63C-pro','Автомат ВА47-63 3P 63А C 6кА EKF PROxima','c01','EKF','шт',3120,3850,4690);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p005','mcb4729-1-10C','Автомат ВА47-29 1P 10А C 4.5кА EKF Basic','c01','EKF','шт',480,620,790);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p101','ctr-12A-230','Контактор КМЭ 12А 230В 1NO EKF Basic','c02','EKF','шт',2900,3650,4500);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p102','ctr-25A-230','Контактор КМЭ 25А 230В 1NO EKF Basic','c02','EKF','шт',3850,4750,5890);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p103','rel-rly-110','Реле промежуточное РЭК77/3 10А 220В EKF','c02','EKF','шт',1450,1820,2290);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p201','cab-vvgng-3x1.5','Кабель ВВГнг-LS 3×1.5 (ГОСТ)','c03','KazКабель','м',220,280,340);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p202','cab-vvgng-3x2.5','Кабель ВВГнг-LS 3×2.5 (ГОСТ)','c03','KazКабель','м',340,420,520);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p203','cab-vvgng-5x6','Кабель ВВГнг-LS 5×6 (ГОСТ)','c03','KazКабель','м',1620,1980,2390);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p204','cab-pvs-2x1.5','Провод ПВС 2×1.5','c03','KazКабель','м',180,230,290);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p301','em-box-67mm','Подрозетник в гипсокартон D67 глубокий','c04','EKF','шт',95,130,170);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p302','em-wago-222-3','Клемма WAGO 222-413 3×2.5мм²','c04','WAGO','шт',145,195,250);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p303','em-corr-20','Гофра ПВХ Ø20 с зондом (бухта 50м)','c04','EKF','м',42,58,75);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p401','shch-shchn-12','Щит навесной ЩРН-П 12 модулей IP41 EKF','c10','EKF','шт',4900,6100,7490);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p402','shch-shchv-24','Щит встраиваемый ЩРВ-П 24 модуля IP41 EKF','c10','EKF','шт',8200,9900,11990);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p501','sok-mn-1','Розетка с/у с заземлением серия Минск белая','c06','EKF Минск','шт',320,420,540);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p502','sok-mn-2','Выключатель 1-кл серия Минск белый','c06','EKF Минск','шт',290,370,470);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p601','led-pnl-36w','Светильник LED панель 36Вт 4000K 595×595','c12','EKF','шт',4200,5200,6490);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p602','led-pr-100','Прожектор LED 100Вт 6500K IP65','c12','EKF','шт',5800,7200,8990);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p701','tool-strip','Стриппер для зачистки кабеля КВТ WS-04A','c09','КВТ','шт',3200,4100,5290);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p702','tool-press','Пресс-клещи ПК-16 для НШВИ КВТ','c09','КВТ','шт',8400,10200,12490);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p801','meas-multi-uni','Мультиметр цифровой Mastech MS8233E','c13','Mastech','шт',6900,8400,10490);
INSERT INTO products (id,sku,name,category_id,brand,unit,price_cost,price_wholesale,price_retail) VALUES ('p901','plug-32-3p','Разъём силовой 3P+E 32A IP44 розетка стац.','c14','EKF','шт',1850,2350,2890);

-- product_stock (склад w1)
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p001','w1',142,24);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p002','w1',88,12);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p003','w1',64,8);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p004','w1',31,3);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p005','w1',320,40);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p101','w1',45,6);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p102','w1',28,2);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p103','w1',110,14);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p201','w1',4200,800);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p202','w1',3800,1200);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p203','w1',950,220);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p204','w1',2400,150);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p301','w1',980,110);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p302','w1',1200,60);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p303','w1',5400,800);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p401','w1',38,5);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p402','w1',17,2);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p501','w1',480,36);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p502','w1',520,28);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p601','w1',92,18);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p602','w1',44,6);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p701','w1',22,3);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p702','w1',11,1);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p801','w1',16,2);
INSERT INTO product_stock (product_id,warehouse_id,stock,reserved) VALUES ('p901','w1',56,4);

-- clients
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl01','ТОО «КарагандыРемСтрой»','180440012345','opt','Бакыт Алимов','+7 701 234 56 78','b.alimov@krs.kz','Караганда','пр. Бухар Жырау, 49','u1',-1240000,18500000,'2026-05-20');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl02','ИП Серикбаев Н.К.','850712301234','rozn','Нурлан Серикбаев','+7 707 812 33 44','serikbaev@mail.ru','Караганда','мкр. Степной-4, 12-15','u1',0,480000,'2026-05-18');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl03','АО «КазахмысЭнерго»','050940005678','opt','Елена Прохорова','+7 7212 56 12 00','e.prohorova@kazmin.kz','Жезказган','ул. Сатпаева, 1','u2',-4800000,62000000,'2026-05-25');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl04','ТОО «АстанаЭлектроМонтаж»','120640098765','opt','Тимур Жакупов','+7 705 901 22 11','t.zhakupov@aem.kz','Астана','пр. Кабанбай батыра, 17','u2',0,9200000,'2026-05-15');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl05','ТОО «ТемиртауМашСервис»','090340051234','opt','Сергей Иванов','+7 702 100 50 11','s.ivanov@tms.kz','Темиртау','пр. Республики, 32','u1',-380000,5400000,'2026-05-22');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl06','ТОО «БалхашЦветМет»','030240076543','opt','Айдос Сариев','+7 7036 22 11 33','a.sariev@bcm.kz','Балхаш','ул. Ленина, 8','u2',0,14200000,'2026-04-30');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl07','ИП Шаймуратов А.К.','780923301122','rozn','Айдар Шаймуратов','+7 708 444 22 11','—','Караганда','ул. Гоголя, 41','u1',0,220000,'2026-05-12');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl08','ТОО «СарыаркаДевелопмент»','160340022334','opt','Гульнара Ахметова','+7 700 333 77 88','g.ahmetova@sd.kz','Караганда','пр. Назарбаева, 110','u2',-920000,7800000,'2026-05-24');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl09','ТОО «ШахтерЭнергоСервис»','110540065432','opt','Виктор Шмидт','+7 7212 41 22 55','v.shmidt@ses.kz','Шахтинск','ул. 40 лет Победы, 5','u1',0,3100000,'2026-05-19');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl10','ТОО «АктауСтройМонтаж»','140940099887','opt','Ерлан Калиев','+7 705 555 11 22','kaliev@asm.kz','Актау','мкр. 1, дом 50','u2',0,2200000,'2026-04-18');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl11','ТОО «ДорстройКЗ»','190140033445','opt','Олег Кравченко','+7 702 800 12 34','o.kravchenko@dskz.kz','Караганда','ул. Промышленная, 7','u1',-2150000,6700000,'2026-05-26');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl12','ИП Жумабекова Г.С.','910415401234','rozn','Гульмира Жумабекова','+7 707 222 88 99','—','Караганда','ул. Ермекова, 60','u1',0,95000,'2026-05-10');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl13','ТОО «КарагандыНефтеТранс»','070240088991','opt','Марат Турсунов','+7 7212 99 11 22','m.tursunov@knt.kz','Караганда','промзона Юго-Восток','u2',0,11500000,'2026-05-05');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl14','ТОО «ЭкоПромРесурс»','210640012398','opt','Дмитрий Лазарев','+7 701 700 50 50','d.lazarev@epr.kz','Темиртау','пр. Мира, 88','u1',-180000,1900000,'2026-05-21');
INSERT INTO clients (id,name,bin,type_key,contact,phone,email,city,address,manager_id,balance,ltv,last_deal) VALUES ('cl15','ТОО «АлматыЭлектро»','050840045678','dilr','Аскар Бекжанов','+7 727 250 33 44','a.bekzhanov@ae.kz','Алматы','ул. Райымбека, 250','u2',0,28000000,'2026-05-23');

-- tags + client_tags
INSERT INTO tags (id,name) VALUES (1,'постоянный');
INSERT INTO tags (id,name) VALUES (2,'стройка');
INSERT INTO tags (id,name) VALUES (3,'розница');
INSERT INTO tags (id,name) VALUES (4,'ключевой');
INSERT INTO tags (id,name) VALUES (5,'тендер');
INSERT INTO tags (id,name) VALUES (6,'монтажник');
INSERT INTO tags (id,name) VALUES (7,'промышленность');
INSERT INTO tags (id,name) VALUES (8,'застройщик');
INSERT INTO tags (id,name) VALUES (9,'удалённый');
INSERT INTO tags (id,name) VALUES (10,'новый');
INSERT INTO tags (id,name) VALUES (11,'дилер');
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl01',1);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl01',2);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl02',3);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl03',4);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl03',5);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl04',6);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl05',7);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl06',4);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl06',7);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl07',3);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl08',8);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl09',6);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl10',6);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl10',9);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl11',1);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl12',3);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl13',7);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl14',10);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl15',4);
INSERT INTO client_tags (client_id,tag_id) VALUES ('cl15',11);

-- deals
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d001','2026-0148','Поставка автоматов ВА47-63 на ПС-110','cl03','u2','shipped',4820000,12,'2026-05-10','2026-05-30');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d002','2026-0149','Кабель ВВГнг 3×2.5 для ЖК Восточный','cl01','u1','paid',1245000,8,'2026-05-12','2026-05-28');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d003','2026-0150','Дилерская поставка май — освещение + щиты','cl15','u2','invoice',8900000,24,'2026-05-14','2026-06-05');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d004','2026-0151','Электромонтажные изделия для офиса','cl04','u2','agreed',1820000,15,'2026-05-15','2026-06-01');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d005','2026-0152','Щиты ЩРВ-П на 3 секции ЖК «Сарыарка»','cl08','u2','kp',3450000,18,'2026-05-18','2026-06-10');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d006','2026-0153','Контакторы и реле для линии №3','cl05','u1','new',680000,4,'2026-05-22','2026-06-15');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d007','2026-0154','Прожекторы LED 100Вт + кабель','cl11','u1','paid',2150000,11,'2026-05-20','2026-06-03');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d008','2026-0155','Розетки серия Минск + подрозетники','cl09','u1','shipped',760000,6,'2026-05-13','2026-05-25');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d009','2026-0156','Силовая сборка для обогатительной фабрики','cl06','u2','closed',5400000,22,'2026-04-25','2026-05-20');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d010','2026-0157','Стартовый заказ — инструмент и измерения','cl14','u1','kp',320000,3,'2026-05-21','2026-06-04');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d011','2026-0158','Кабеленесущие системы — отдали конкуренту','cl13','u2','lost',1100000,7,'2026-05-02','2026-05-15');
INSERT INTO deals (id,no,title,client_id,manager_id,stage_id,amount,items,created,target) VALUES ('d012','2026-0159','Розничный заказ — мелочи для ремонта','cl02','u1','new',145000,5,'2026-05-26','2026-06-02');

-- deal_items
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p001',80,1180);
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p003',40,3200);
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p004',20,3850);
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p103',60,1820);
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p202',300,420);
INSERT INTO deal_items (deal_id,product_id,qty,price_used) VALUES ('d001','p401',30,6100);

-- leads
INSERT INTO leads (id,source_id,name,phone,subject,status_id,created) VALUES ('l01',1,'Айбек Канатов','+7 707 333 44 55','Нужен расчёт по кабелю ВВГнг 5×16','new','2026-05-27 09:14');
INSERT INTO leads (id,source_id,name,phone,subject,status_id,created) VALUES ('l02',2,'Гульшат Серикова','+7 701 888 22 11','Прайс на освещение для склада','in-work','2026-05-27 10:32');
INSERT INTO leads (id,source_id,name,phone,subject,status_id,created) VALUES ('l03',3,'ТОО «Жанаорда»','+7 7212 41 00 99','Тендер на щиты ЩРВ-24, 8 шт','in-work','2026-05-26 16:48');
INSERT INTO leads (id,source_id,name,phone,subject,status_id,created) VALUES ('l04',1,'Денис Капитонов','+7 705 100 33 22','Срочно нужны автоматы 25А 3P, 40 шт','converted','2026-05-26 14:10');
INSERT INTO leads (id,source_id,name,phone,subject,status_id,created) VALUES ('l05',2,'ИП Ыбраев','+7 702 700 80 90','Розетки Минск, оптом','new','2026-05-26 11:05');

-- tasks
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t01','Перезвонить АО «КазахмысЭнерго» по доплате','2026-05-27 14:00','u2','d001','high',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t02','Согласовать КП с ТОО «Сарыарка» (д. 0152)','2026-05-27 16:00','u2','d005','high',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t03','Отгрузить заказ ТОО «ШахтерЭнергоСервис»','2026-05-27 11:00','u3','d008','medium',1);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t04','Закрыть задолженность ТОО «ДорстройКЗ» (2.15М)','2026-05-28 12:00','u4','d007','high',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t05','Подготовить договор для нового клиента (cl14)','2026-05-28 15:00','u4',NULL,'medium',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t06','Заказ EKF на июнь — согласовать с Морозовым','2026-05-29 10:00','u5',NULL,'medium',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t07','Инвентаризация склада — щиты','2026-05-30 09:00','u3',NULL,'low',0);
INSERT INTO tasks (id,title,due,owner_id,deal_id,priority_id,done) VALUES ('t08','Обработать заявку l01 (Айбек Канатов)','2026-05-27 12:00','u1',NULL,'medium',0);

-- invoices
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv01','СФ-2026-0234','d001','cl03','2026-05-15',4820000,'paid','2026-05-25');
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv02','СФ-2026-0235','d002','cl01','2026-05-16',1245000,'paid','2026-05-26');
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv03','СФ-2026-0236','d003','cl15','2026-05-20',8900000,'pending','2026-06-05');
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv04','СФ-2026-0237','d007','cl11','2026-05-22',2150000,'overdue','2026-05-24');
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv05','СФ-2026-0238','d008','cl09','2026-05-18',760000,'paid','2026-05-23');
INSERT INTO invoices (id,no,deal_id,client_id,date,amount,status_id,due) VALUES ('iv06','СФ-2026-0239','d009','cl06','2026-04-28',5400000,'paid','2026-05-15');

-- shipments
INSERT INTO shipments (id,no,deal_id,client_id,date,items,weight,transport,driver,status_id,destination) VALUES ('sh01','ТТН-0512','d001','cl03','2026-05-21',12,320,'Газель собственная','Куаныш А.','delivered','Жезказган, ул. Сатпаева, 1');
INSERT INTO shipments (id,no,deal_id,client_id,date,items,weight,transport,driver,status_id,destination) VALUES ('sh02','ТТН-0513','d002','cl01','2026-05-22',8,540,'Самовывоз','—','delivered','Караганда, склад клиента');
INSERT INTO shipments (id,no,deal_id,client_id,date,items,weight,transport,driver,status_id,destination) VALUES ('sh03','ТТН-0514','d008','cl09','2026-05-23',6,28,'Газель собственная','Куаныш А.','delivered','Шахтинск, ул. 40 лет Победы, 5');
INSERT INTO shipments (id,no,deal_id,client_id,date,items,weight,transport,driver,status_id,destination) VALUES ('sh04','ТТН-0515','d007','cl11','2026-05-28',11,180,'Транспортная Astana Trans','—','planned','Караганда, ул. Промышленная, 7');

-- receipts
INSERT INTO receipts (id,no,supplier_id,date,items,amount,status,note) VALUES ('rc01','ПРХ-0089','sp1','2026-05-20',142,8200000,'оприходовано','Месячная партия EKF — автоматы + контакторы + щиты');
INSERT INTO receipts (id,no,supplier_id,date,items,amount,status,note) VALUES ('rc02','ПРХ-0090','sp2','2026-05-22',4200,2400000,'оприходовано','Кабель ВВГнг 3×1.5 и 3×2.5');
INSERT INTO receipts (id,no,supplier_id,date,items,amount,status,note) VALUES ('rc03','ПРХ-0091','sp4','2026-05-08',28,380000,'оприходовано','Инструмент КВТ — пресс-клещи и стрипперы');

-- notifications
INSERT INTO notifications (text,type) VALUES ('Просрочка оплаты по СФ-2026-0237 (ТОО ДорстройКЗ, 2.15М ₸)','error');
INSERT INTO notifications (text,type) VALUES ('Новая заявка с сайта от Айбека Канатова','info');
INSERT INTO notifications (text,type) VALUES ('Низкий остаток: Автомат ВА47-63 3P 63А (31 шт)','warn');
INSERT INTO notifications (text,type) VALUES ('Поставка EKF на 08.06 подтверждена','info');
