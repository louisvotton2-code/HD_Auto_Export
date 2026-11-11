import type { Locale } from '@/i18n/routing';
import type { PartCategory } from '../types';

type PartsCopy = {
  title: string; titleAccent: string; subtitle: string; kicker: string; metaDescription: string;
  search: string; searchHint: string; catalog: string; catalogBody: string; filters: string;
  brand: string; category: string; all: string; price: string; min: string; max: string;
  apply: string; reset: string; sort: string; defaultSort: string; ascending: string; descending: string; byName: string;
  count: (value: number) => string; empty: string; invalidPrice: string; details: string;
  shownRange: (count: number) => string; referenceCount: (formattedCount: string) => string;
  pagination: string; previousPage: string; nextPage: string; pageLabel: (page: number) => string;
  oem: string; referencePrice: string; priceOnRequest: string; priceNote: string; unknown: string;
  home: string; back: string; specifications: string; fitment: string; fitmentBody: string;
  quantity: string; updateQuantity: string; quantityHelp: string; invalidQuantity: string;
  decrease: string; increase: string; telegram: string; whatsapp: string; contactNote: string;
  photos: string; referenceImage: string; noPhoto: string; openImage: string; closeImage: string;
  previousImage: string; nextImage: string; image: (index: number) => string;
  related: string; relatedBody: string; save: string; unsave: string;
  favorites: string; allParts: string; favoritesEmpty: string;
  stats: [string, string, string]; quickBrowse: string;
  serviceTitle: string; serviceBody: string;
  services: [title: string, body: string][];
  enquiryTitle: string; enquiryBody: string; enquiryAction: string; contactLabel: string; phoneLabel: string;
  categories: Record<PartCategory, string>;
};

export const partsContent = {
  zh: {
    title: '按 OEM 编号查找', titleAccent: '现代汽车配件', kicker: 'HD AUTO EXPORT · 汽车配件',
    subtitle: '浏览配件号和参考价格，与我们沟通适配车型、采购数量和运输需求。',
    metaDescription: '浏览 HD Auto Export 的汽车配件资料、配件号和参考价格，联系我们确认适配及运输。',
    search: '搜索配件', searchHint: '输入配件号或名称', catalog: '汽车配件目录',
    catalogBody: '按配件号选择，逐项确认规格与适配。', filters: '筛选配件', brand: '品牌目录', category: '配件类别', all: '全部',
    price: '参考价格 · USD', min: '最低参考价', max: '最高参考价', apply: '应用筛选', reset: '清除筛选',
    sort: '排序', defaultSort: '默认顺序', ascending: '参考价从低到高', descending: '参考价从高到低', byName: '配件名称',
    count: (n) => `显示 ${n} 条配件资料`, empty: '没有符合条件的配件。请调整筛选，或联系我们按配件号咨询。',
    shownRange: (n) => `显示第 1–${n} 条配件资料`, referenceCount: (n) => `目录规模参考 ${n}`,
    pagination: '配件目录分页', previousPage: '上一页', nextPage: '下一页', pageLabel: (n) => `第 ${n} 页`,
    invalidPrice: '请输入有效的价格区间，最低价不能高于最高价。', details: '查看详情', oem: '配件号',
    referencePrice: 'USD参考价', priceOnRequest: '价格请咨询', priceNote: '参考价不含运费及进口费用。最终规格、数量与报价请通过咨询确认。', unknown: '—',
    home: '首页', back: '返回配件目录', specifications: '配件信息', fitment: '确认车辆适配',
    fitmentBody: '请提供车辆型号、年份和配件号，沟通适配细节。图片为配件参考图，不替代实物与规格确认。',
    quantity: '咨询数量', updateQuantity: '更新数量', quantityHelp: '选择数量后更新，再打开咨询草稿。', invalidQuantity: '咨询数量须为1–999的整数。',
    decrease: '减少数量', increase: '增加数量', telegram: 'Telegram咨询', whatsapp: 'WhatsApp咨询',
    contactNote: '配件号、名称、数量和详情链接会预填到聊天草稿，由你确认后发送。',
    photos: '配件图片', referenceImage: '配件参考图', noPhoto: '图片请咨询', openImage: '查看大图', closeImage: '关闭大图',
    previousImage: '上一张图片', nextImage: '下一张图片', image: (n) => `查看第${n}张图片`,
    related: '更多相关配件', relatedBody: '同一类别的配件资料，具体适配请按配件号确认。', save: '收藏配件', unsave: '取消收藏配件',
    favorites: '已收藏', allParts: '全部配件', favoritesEmpty: '暂无收藏配件。',
    stats: ['配件类别', '目录规模参考', '可浏览配件资料'], quickBrowse: '热门车型',
    serviceTitle: '从选型到交付，沟通每个细节', serviceBody: '告诉我们配件号与使用车型，一起确认采购和运输方案。',
    services: [
      ['核对配件号', '用 OEM 编号核对名称、图片和参考价。'],
      ['确认车型适配', '提供车型和年款，便于核对配件规格。'],
      ['确认数量与报价', '按所需数量沟通配件报价。'],
      ['沟通包装与运输', '提供目的地，确认包装和运输安排。'],
    ],
    enquiryTitle: '咨询配件报价', enquiryBody: '通过 Telegram 或 WhatsApp 提供配件号、车辆信息和所需数量。',
    enquiryAction: '咨询配件', contactLabel: '联系方式', phoneLabel: '电话',
    categories: { chassis: '底盘与车轮', transmission: '传动系统', components: '机电与通用部件', body: '车身与灯具' },
  },
  en: {
    title: 'Find parts by OEM number for', titleAccent: 'Hyundai', kicker: 'HD AUTO EXPORT · AUTO PARTS',
    subtitle: 'Browse part numbers and reference prices. Discuss vehicle fitment, quantities and delivery with us.',
    metaDescription: 'View part numbers and reference prices in the HD Auto Export catalog. Contact us about fitment, quantities and delivery.',
    search: 'Search parts', searchHint: 'Part number or name', catalog: 'Auto parts catalog',
    catalogBody: 'Start with the part number, then confirm specifications and fitment.', filters: 'Filters', brand: 'Brand catalog', category: 'Category', all: 'All',
    price: 'Reference price · USD', min: 'Minimum reference price', max: 'Maximum reference price', apply: 'Apply filters', reset: 'Clear filters',
    sort: 'Sort', defaultSort: 'Default order', ascending: 'Reference price: low to high', descending: 'Reference price: high to low', byName: 'Part name',
    count: (n) => `Showing ${n} ${n === 1 ? 'part record' : 'part records'}`, empty: 'No parts match these filters. Try another selection or contact us with the part number.',
    shownRange: (n) => `Showing part records 1–${n}`, referenceCount: (n) => `Reference catalog size ${n}`,
    pagination: 'Parts catalog pagination', previousPage: 'Previous page', nextPage: 'Next page', pageLabel: (n) => `Page ${n}`,
    invalidPrice: 'Enter a valid price range. The minimum cannot exceed the maximum.', details: 'View details', oem: 'Part number',
    referencePrice: 'USD reference price', priceOnRequest: 'Price on request', priceNote: 'Reference prices exclude shipping and import charges. Confirm specifications, quantities and the final quotation in chat.', unknown: '—',
    home: 'Home', back: 'Back to parts', specifications: 'Part information', fitment: 'Confirm vehicle fitment',
    fitmentBody: 'Share the model, year and part number to discuss fitment. Reference images do not replace checking the actual item and specifications.',
    quantity: 'Enquiry quantity', updateQuantity: 'Update quantity', quantityHelp: 'Update your quantity before opening the enquiry draft.', invalidQuantity: 'Enter a whole quantity from 1 to 999.',
    decrease: 'Decrease quantity', increase: 'Increase quantity', telegram: 'Ask on Telegram', whatsapp: 'Ask on WhatsApp',
    contactNote: 'The draft includes the part number, name, quantity and detail link. Review it and send it yourself.',
    photos: 'Part images', referenceImage: 'Part reference image', noPhoto: 'Ask for images', openImage: 'Open full image', closeImage: 'Close full image',
    previousImage: 'Previous image', nextImage: 'Next image', image: (n) => `View image ${n}`,
    related: 'Related parts', relatedBody: 'Other records in this category. Confirm exact fitment by part number.', save: 'Save part', unsave: 'Unsave part',
    favorites: 'Saved parts', allParts: 'All parts', favoritesEmpty: 'No saved parts yet.',
    stats: ['Categories', 'Reference catalog size', 'Part records to browse'], quickBrowse: 'Popular models',
    serviceTitle: 'Discuss every detail, from selection to delivery', serviceBody: 'Share the part number and vehicle information to plan sourcing and delivery.',
    services: [
      ['Check the part number', 'Use the OEM number to check the name, image and reference price.'],
      ['Confirm vehicle fitment', 'Share the model and year to check the specifications.'],
      ['Confirm quantities and pricing', 'Include the quantity you need when asking for a quote.'],
      ['Discuss packing and delivery', 'Share the destination to discuss packaging and shipping.'],
    ],
    enquiryTitle: 'Get a parts quote', enquiryBody: 'Share the part number, vehicle details and quantity on Telegram or WhatsApp.',
    enquiryAction: 'Ask about a part', contactLabel: 'Contacts', phoneLabel: 'Phone',
    categories: { chassis: 'Chassis & wheels', transmission: 'Transmission', components: 'Assemblies & components', body: 'Body & lighting' },
  },
  ru: {
    title: 'Найдите запчасти по номеру OEM для', titleAccent: 'Hyundai', kicker: 'HD AUTO EXPORT · ЗАПЧАСТИ',
    subtitle: 'Посмотрите номера деталей и ориентировочные цены. Уточните совместимость, количество и доставку.',
    metaDescription: 'Каталог запчастей HD Auto Export с номерами и ориентировочными ценами. Свяжитесь с нами, чтобы уточнить совместимость и доставку.',
    search: 'Найти запчасти', searchHint: 'Номер или название', catalog: 'Каталог запчастей',
    catalogBody: 'Начните с номера детали, затем уточните характеристики и совместимость.', filters: 'Фильтры', brand: 'Каталог марки', category: 'Категория', all: 'Все',
    price: 'Ориентировочная цена · USD', min: 'Минимальная цена', max: 'Максимальная цена', apply: 'Применить фильтры', reset: 'Сбросить фильтры',
    sort: 'Сортировка', defaultSort: 'По умолчанию', ascending: 'Цена по возрастанию', descending: 'Цена по убыванию', byName: 'Название детали',
    count: (n) => `Показано позиций — ${n}`, empty: 'По этим условиям ничего не найдено. Измените фильтры или сообщите номер детали.',
    shownRange: (n) => `Показаны позиции 1–${n}`, referenceCount: (n) => `Справочный объём каталога ${n}`,
    pagination: 'Страницы каталога запчастей', previousPage: 'Предыдущая страница', nextPage: 'Следующая страница', pageLabel: (n) => `Страница ${n}`,
    invalidPrice: 'Укажите корректный диапазон цен: минимум не должен превышать максимум.', details: 'Подробнее', oem: 'Номер детали',
    referencePrice: 'Ориентировочная цена в USD', priceOnRequest: 'Цена по запросу', priceNote: 'Цена справочная, без доставки и импортных платежей. Характеристики, количество и итоговое предложение уточните в чате.', unknown: '—',
    home: 'Главная', back: 'Вернуться к запчастям', specifications: 'Информация о детали', fitment: 'Уточнить совместимость',
    fitmentBody: 'Укажите модель, год и номер детали. Изображения служат ориентиром и не заменяют проверку конкретной детали и характеристик.',
    quantity: 'Количество для запроса', updateQuantity: 'Обновить количество', quantityHelp: 'Обновите количество перед открытием черновика обращения.', invalidQuantity: 'Введите целое количество от 1 до 999.',
    decrease: 'Уменьшить количество', increase: 'Увеличить количество', telegram: 'Спросить в Telegram', whatsapp: 'Спросить в WhatsApp',
    contactNote: 'В черновик войдут номер, название, количество и ссылка на деталь. Проверьте и отправьте сообщение сами.',
    photos: 'Изображения детали', referenceImage: 'Справочное изображение детали', noPhoto: 'Уточнить изображения', openImage: 'Открыть изображение', closeImage: 'Закрыть изображение',
    previousImage: 'Предыдущее изображение', nextImage: 'Следующее изображение', image: (n) => `Посмотреть изображение ${n}`,
    related: 'Другие детали', relatedBody: 'Другие записи этой категории. Совместимость уточняется по номеру детали.', save: 'Сохранить деталь', unsave: 'Убрать деталь',
    favorites: 'Сохранённые', allParts: 'Все запчасти', favoritesEmpty: 'Сохранённых деталей пока нет.',
    stats: ['Категорий', 'Справочный объём каталога', 'Записей для просмотра'], quickBrowse: 'Популярные модели',
    serviceTitle: 'От подбора до доставки — обсудим детали', serviceBody: 'Сообщите номер детали и сведения об автомобиле для согласования заказа и доставки.',
    services: [
      ['Проверка номера детали', 'По номеру OEM можно сверить название, фото и ориентировочную цену.'],
      ['Проверка совместимости', 'Укажите модель и год выпуска, чтобы сверить характеристики.'],
      ['Количество и цена', 'Укажите нужное количество при запросе цены.'],
      ['Упаковка и доставка', 'Сообщите место назначения, чтобы обсудить упаковку и доставку.'],
    ],
    enquiryTitle: 'Запрос цены на запчасти', enquiryBody: 'Укажите номер детали, данные автомобиля и количество в Telegram или WhatsApp.',
    enquiryAction: 'Уточнить по детали', contactLabel: 'Контакты', phoneLabel: 'Телефон',
    categories: { chassis: 'Шасси и колёса', transmission: 'Трансмиссия', components: 'Узлы и компоненты', body: 'Кузов и свет' },
  },
} satisfies Record<Locale, PartsCopy>;
