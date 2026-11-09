import type { Locale } from '@/i18n/routing';
import type { PartCategory } from '../types';

type PartsCopy = {
  title: string; titleAccent: string; subtitle: string; kicker: string; metaDescription: string;
  search: string; searchHint: string; catalog: string; catalogBody: string; filters: string;
  brand: string; category: string; all: string; price: string; min: string; max: string;
  apply: string; reset: string; sort: string; defaultSort: string; ascending: string; descending: string; byName: string;
  count: (value: number) => string; empty: string; invalidPrice: string; details: string;
  oem: string; referencePrice: string; priceOnRequest: string; priceNote: string; unknown: string;
  home: string; back: string; specifications: string; fitment: string; fitmentBody: string;
  quantity: string; updateQuantity: string; quantityHelp: string; invalidQuantity: string;
  decrease: string; increase: string; telegram: string; whatsapp: string; contactNote: string;
  photos: string; referenceImage: string; noPhoto: string; openImage: string; closeImage: string;
  previousImage: string; nextImage: string; image: (index: number) => string;
  related: string; relatedBody: string; save: string; unsave: string;
  favorites: string; allParts: string; favoritesEmpty: string;
  stats: [string, string, string]; quickBrowse: string;
  serviceTitle: string; serviceBody: string; services: [string, string, string];
  enquiryTitle: string; enquiryBody: string;
  categories: Record<PartCategory, string>;
  demoNotice: string; demoSearched: string; demoPart: string; demoUnavailable: string;
  demoPagination: string; previousPage: string; nextPage: string;
  demoCount: (total: number, page: number, pages: number) => string;
};

export const partsContent = {
  zh: {
    title: '为你的汽车', titleAccent: '找到合适配件', kicker: 'HD AUTO EXPORT · 汽车配件',
    subtitle: '按配件号、名称和类别浏览。与我们沟通适配车型、采购数量和运输需求。',
    metaDescription: '浏览HD Auto Export汽车配件目录，按配件号、类别与参考价格筛选，联系咨询适配及运输。',
    search: '搜索配件', searchHint: '输入配件号或名称，例如 52910K2200', catalog: '汽车配件目录',
    catalogBody: '按配件号选择，逐项确认规格与适配。', filters: '筛选配件', brand: '品牌目录', category: '配件类别', all: '全部',
    price: '参考价格 · USD', min: '最低参考价', max: '最高参考价', apply: '应用筛选', reset: '清除筛选',
    sort: '排序', defaultSort: '默认顺序', ascending: '参考价从低到高', descending: '参考价从高到低', byName: '配件名称',
    count: (n) => `共 ${n} 条配件资料`, empty: '没有符合条件的配件。请调整筛选，或联系我们按配件号咨询。',
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
    favorites: '已收藏', allParts: '全部配件', favoritesEmpty: '暂无符合条件的收藏配件。可先收藏配件，或清除筛选后查看。',
    stats: ['演示配件数', '配件类别', '参考价币种'], quickBrowse: '按类别快速浏览',
    serviceTitle: '从选型到交付，沟通每个细节', serviceBody: '告诉我们配件号与使用车型，一起确认采购和运输方案。',
    services: ['核对配件号与适配', '确认数量与报价', '沟通包装与运输'],
    enquiryTitle: '没有找到需要的配件？', enquiryBody: '把配件号、车辆信息或图片发给我们，沟通你需要的型号与数量。',
    demoNotice: '配件目录演示。查询和翻页均保留当前展示样例。', demoSearched: '演示查询已完成。当前展示样例保持不变。',
    demoPart: '演示配件', demoUnavailable: '暂不可询价', demoPagination: '演示分页',
    previousPage: '上一页', nextPage: '下一页',
    demoCount: (total, page, pages) => `演示共 ${total} 条 · 第 ${page} / ${pages} 页`,
    categories: { chassis: '底盘与车轮', transmission: '传动系统', components: '机电与通用部件', body: '车身与灯具' },
  },
  en: {
    title: 'Find the right', titleAccent: 'parts for your car', kicker: 'HD AUTO EXPORT · AUTO PARTS',
    subtitle: 'Browse by part number, name and category. Discuss vehicle fitment, quantities and delivery with us.',
    metaDescription: 'Browse HD Auto Export auto parts by number, category and reference price. Ask about fitment, quantities and delivery.',
    search: 'Search parts', searchHint: 'Part number or name, e.g. 52910K2200', catalog: 'Auto parts catalog',
    catalogBody: 'Start with the part number, then confirm specifications and fitment.', filters: 'Filters', brand: 'Brand catalog', category: 'Category', all: 'All',
    price: 'Reference price · USD', min: 'Minimum reference price', max: 'Maximum reference price', apply: 'Apply filters', reset: 'Clear filters',
    sort: 'Sort', defaultSort: 'Default order', ascending: 'Reference price: low to high', descending: 'Reference price: high to low', byName: 'Part name',
    count: (n) => `${n} part records`, empty: 'No parts match these filters. Try another selection or contact us with the part number.',
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
    favorites: 'Saved parts', allParts: 'All parts', favoritesEmpty: 'No saved parts match these filters. Save a part or clear the filters to see more.',
    stats: ['Demo part count', 'Categories', 'Reference currency'], quickBrowse: 'Browse by category',
    serviceTitle: 'Discuss every detail, from selection to delivery', serviceBody: 'Share the part number and vehicle information to plan sourcing and delivery.',
    services: ['Confirm part numbers and fitment', 'Agree quantities and pricing', 'Discuss packing and delivery'],
    enquiryTitle: 'Looking for another part?', enquiryBody: 'Send the part number, vehicle information or a photo to discuss the item and quantity you need.',
    demoNotice: 'Catalog preview. Searches and page changes keep the same sample records.', demoSearched: 'Demo search complete. The sample records stay the same.',
    demoPart: 'Sample part', demoUnavailable: 'Unavailable for enquiry', demoPagination: 'Demo pagination',
    previousPage: 'Previous page', nextPage: 'Next page',
    demoCount: (total, page, pages) => `${total} demo records · Page ${page} of ${pages}`,
    categories: { chassis: 'Chassis & wheels', transmission: 'Transmission', components: 'Assemblies & components', body: 'Body & lighting' },
  },
  ru: {
    title: 'Подберите нужные', titleAccent: 'запчасти для авто', kicker: 'HD AUTO EXPORT · ЗАПЧАСТИ',
    subtitle: 'Ищите по номеру, названию и категории. Обсудите совместимость, количество и доставку.',
    metaDescription: 'Каталог запчастей HD Auto Export: поиск по номеру, категории и ориентировочной цене. Консультации по совместимости и доставке.',
    search: 'Найти запчасти', searchHint: 'Номер или название, например 52910K2200', catalog: 'Каталог запчастей',
    catalogBody: 'Начните с номера детали, затем уточните характеристики и совместимость.', filters: 'Фильтры', brand: 'Каталог марки', category: 'Категория', all: 'Все',
    price: 'Ориентировочная цена · USD', min: 'Минимальная цена', max: 'Максимальная цена', apply: 'Применить фильтры', reset: 'Сбросить фильтры',
    sort: 'Сортировка', defaultSort: 'По умолчанию', ascending: 'Цена по возрастанию', descending: 'Цена по убыванию', byName: 'Название детали',
    count: (n) => `Записей о деталях: ${n}`, empty: 'По этим условиям ничего не найдено. Измените фильтры или сообщите номер детали.',
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
    favorites: 'Сохранённые', allParts: 'Все запчасти', favoritesEmpty: 'Нет сохранённых деталей по этим условиям. Сохраните деталь или сбросьте фильтры.',
    stats: ['Деталей в демокаталоге', 'Категорий', 'Валюта справочной цены'], quickBrowse: 'Выбрать категорию',
    serviceTitle: 'От подбора до доставки — обсудим детали', serviceBody: 'Сообщите номер детали и сведения об автомобиле для согласования заказа и доставки.',
    services: ['Номера деталей и совместимость', 'Количество и стоимость', 'Упаковка и доставка'],
    enquiryTitle: 'Нужна другая запчасть?', enquiryBody: 'Пришлите номер, сведения об автомобиле или фото, чтобы обсудить нужную деталь и количество.',
    demoNotice: 'Демонстрационный каталог. Поиск и смена страницы сохраняют те же примеры.', demoSearched: 'Демонстрационный поиск завершён. Примеры остались прежними.',
    demoPart: 'Пример детали', demoUnavailable: 'Недоступно для запроса', demoPagination: 'Страницы демокаталога',
    previousPage: 'Предыдущая страница', nextPage: 'Следующая страница',
    demoCount: (total, page, pages) => `${total} демозаписей · Страница ${page} из ${pages}`,
    categories: { chassis: 'Шасси и колёса', transmission: 'Трансмиссия', components: 'Узлы и компоненты', body: 'Кузов и свет' },
  },
} satisfies Record<Locale, PartsCopy>;
