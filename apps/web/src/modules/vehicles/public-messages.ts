import type { Locale } from '@/i18n/routing';
import type { Availability, Powertrain, VehicleFacts } from '@hd/contracts/public';

type VehicleCopy = {
  eyebrow: string;
  curated: string;
  more: string;
  title: string;
  intro: string;
  make: string;
  model: string;
  powertrain: string;
  all: string;
  apply: string;
  reset: string;
  loading: string;
  empty: string;
  unavailable: string;
  retry: string;
  filterUnavailable: string;
  results: string;
  currentPage: string;
  previous: string;
  next: string;
  pagination: string;
  totalUnknown: string;
  details: string;
  stockCodeLabel: string;
  unknown: string;
  yearLabel: string;
  mileageLabel: string;
  km: string;
  manufactureLabel: string;
  registrationLabel: string;
  engineLabel: string;
  powerLabel: string;
  bodyLabel: string;
  transmissionLabel: string;
  locationLabel: string;
  availabilityLabel: string;
  priceNote: string;
  priceLabels: Record<'asking' | 'reference' | 'on_request', string>;
  availability: Record<Availability, string>;
  powertrains: Record<Powertrain, string>;
  bodies: Record<NonNullable<VehicleFacts['body']>, string>;
  transmissions: Record<NonNullable<VehicleFacts['transmission']>, string>;
  contactTelegram: string;
  contactWhatsapp: string;
  contactNote: string;
  similar: string;
  back: string;
  specifications: string;
  estimate: string;
  estimateNote: string;
  gallery: string;
  inclusions: string;
  stale: string;
};

const messages = {
  zh: {
    eyebrow: 'HD AUTO EXPORT · 精选车源',
    curated: '精选车源',
    more: '更多车源',
    title: '探索你的下一辆车',
    intro: '浏览精选车源，按品牌、车型和动力筛选。',
    make: '品牌',
    model: '车型',
    powertrain: '动力类型',
    all: '全部',
    apply: '应用筛选',
    reset: '清除筛选',
    loading: '正在加载车辆…',
    empty: '没有找到符合条件的车辆资料。请调整筛选或稍后再来。',
    unavailable: '暂时无法加载车辆资料，请稍后重试。',
    retry: '重新加载',
    filterUnavailable: '筛选选项暂不可用，仍可浏览当前车辆资料。',
    results: '条车辆资料',
    currentPage: '当前页',
    previous: '上一页',
    next: '下一页',
    pagination: '车辆目录分页',
    totalUnknown: '当前页资料',
    details: '查看详情',
    stockCodeLabel: '咨询编号',
    unknown: '—',
    yearLabel: '年款',
    mileageLabel: '里程',
    km: '公里',
    manufactureLabel: '制造时间',
    registrationLabel: '首次登记时间',
    engineLabel: '排量',
    powerLabel: '功率',
    bodyLabel: '车身类型',
    transmissionLabel: '变速箱',
    locationLabel: '所在地',
    availabilityLabel: '车辆状态',
    priceNote: '价格及所含项目以本页标示为准，最终车辆状况和报价请咨询确认。',
    priceLabels: { asking: '公开售价', reference: '参考价格', on_request: '待询价' },
    availability: { available: '可售', reserved: '已预订', sold: '已售', unknown: '' },
    powertrains: {
      petrol: '汽油',
      diesel: '柴油',
      hev: '混合动力',
      phev: '插电混动',
      erev: '增程',
      bev: '纯电',
      lpg: '液化石油气',
      other: '其他动力',
      unknown: '—',
    },
    bodies: {
      hatchback: '两厢车',
      suv: 'SUV',
      sedan: '轿车',
      wagon: '旅行车',
      coupe: '轿跑',
      convertible: '敞篷车',
      van: '厢式车',
      pickup: '皮卡',
      other: '其他车身',
      unknown: '—',
    },
    transmissions: {
      manual: '手动',
      automatic: '自动',
      cvt: '无级变速',
      dct: '双离合',
      other: '其他变速箱',
      unknown: '—',
    },
    contactTelegram: '通过 Telegram 咨询',
    contactWhatsapp: '通过 WhatsApp 咨询',
    contactNote: '将在聊天工具中预填车辆资料，由你确认并发送。',
    similar: '此车已售，咨询类似车辆',
    back: '返回精选车源',
    specifications: '车辆资料',
    estimate: '打开费用计算器',
    estimateNote: '请按车辆资料填写计算参数。',
    gallery: '查看其他照片',
    inclusions: '价格所含项目',
    stale: '当前显示的是较早的数据，请咨询最新状态。',
  },
  en: {
    eyebrow: 'HD AUTO EXPORT · SELECTED VEHICLES',
    curated: 'Selected vehicles',
    more: 'More vehicles',
    title: 'Explore your next car',
    intro: 'Browse selected vehicles and filter by make, model and powertrain.',
    make: 'Make',
    model: 'Model',
    powertrain: 'Powertrain',
    all: 'All',
    apply: 'Apply filters',
    reset: 'Clear filters',
    loading: 'Loading vehicles…',
    empty:
      'No vehicle information matches these filters. Try another selection or check back later.',
    unavailable: 'Vehicle information is temporarily unavailable. Please try again.',
    retry: 'Reload',
    filterUnavailable:
      'Filter options are temporarily unavailable. You can still browse the current vehicle information.',
    results: 'vehicle records',
    currentPage: 'Page',
    previous: 'Previous',
    next: 'Next',
    pagination: 'Vehicle catalog pages',
    totalUnknown: 'Records on this page',
    details: 'View details',
    stockCodeLabel: 'Inquiry reference',
    unknown: '—',
    yearLabel: 'Model year',
    mileageLabel: 'Mileage',
    km: 'km',
    manufactureLabel: 'Manufactured',
    registrationLabel: 'First registration',
    engineLabel: 'Engine capacity',
    powerLabel: 'Power',
    bodyLabel: 'Body',
    transmissionLabel: 'Transmission',
    locationLabel: 'Location',
    availabilityLabel: 'Vehicle status',
    priceNote:
      'The displayed price and inclusions are as listed. Confirm vehicle condition and the final quotation with us.',
    priceLabels: {
      asking: 'Advertised price',
      reference: 'Reference price',
      on_request: 'Price on request',
    },
    availability: {
      available: 'Available',
      reserved: 'Reserved',
      sold: 'Sold',
      unknown: '',
    },
    powertrains: {
      petrol: 'Petrol',
      diesel: 'Diesel',
      hev: 'Hybrid',
      phev: 'Plug-in hybrid',
      erev: 'Range extender',
      bev: 'Electric',
      lpg: 'LPG',
      other: 'Other powertrain',
      unknown: '—',
    },
    bodies: {
      hatchback: 'Hatchback',
      suv: 'SUV',
      sedan: 'Sedan',
      wagon: 'Wagon',
      coupe: 'Coupe',
      convertible: 'Convertible',
      van: 'Van',
      pickup: 'Pickup',
      other: 'Other body',
      unknown: '—',
    },
    transmissions: {
      manual: 'Manual',
      automatic: 'Automatic',
      cvt: 'CVT',
      dct: 'Dual clutch',
      other: 'Other transmission',
      unknown: '—',
    },
    contactTelegram: 'Ask on Telegram',
    contactWhatsapp: 'Ask on WhatsApp',
    contactNote:
      'Vehicle information is prefilled in your chat app. Review it and send it yourself.',
    similar: 'This car is sold — ask about similar cars',
    back: 'Back to selected vehicles',
    specifications: 'Vehicle information',
    estimate: 'Open cost calculator',
    estimateNote: 'Enter the vehicle details in the calculator.',
    gallery: 'View other photos',
    inclusions: 'Price inclusions',
    stale: 'The displayed data is older. Ask us for the latest status.',
  },
  ru: {
    eyebrow: 'HD AUTO EXPORT · ПОДБОРКА АВТО',
    curated: 'Подборка автомобилей',
    more: 'Больше автомобилей',
    title: 'Найдите свой следующий автомобиль',
    intro: 'Выбирайте автомобили по марке, модели и типу двигателя.',
    make: 'Марка',
    model: 'Модель',
    powertrain: 'Тип двигателя',
    all: 'Все',
    apply: 'Применить фильтры',
    reset: 'Сбросить фильтры',
    loading: 'Загружаем автомобили…',
    empty: 'Нет данных об автомобилях по выбранным условиям. Измените фильтры или зайдите позже.',
    unavailable: 'Данные об автомобилях временно недоступны. Попробуйте ещё раз.',
    retry: 'Обновить',
    filterUnavailable:
      'Фильтры временно недоступны. Просмотр текущих данных об автомобилях доступен.',
    results: 'записей об авто',
    currentPage: 'Страница',
    previous: 'Назад',
    next: 'Далее',
    pagination: 'Страницы каталога автомобилей',
    totalUnknown: 'Записей на этой странице',
    details: 'Подробнее',
    stockCodeLabel: 'Номер для запроса',
    unknown: '—',
    yearLabel: 'Модельный год',
    mileageLabel: 'Пробег',
    km: 'км',
    manufactureLabel: 'Дата производства',
    registrationLabel: 'Первая регистрация',
    engineLabel: 'Объём двигателя',
    powerLabel: 'Мощность',
    bodyLabel: 'Кузов',
    transmissionLabel: 'Коробка передач',
    locationLabel: 'Местонахождение',
    availabilityLabel: 'Статус автомобиля',
    priceNote:
      'Цена и включённые расходы указаны на странице. Уточните состояние автомобиля и итоговое предложение у нас.',
    priceLabels: {
      asking: 'Цена продажи',
      reference: 'Ориентировочная цена',
      on_request: 'Цена по запросу',
    },
    availability: {
      available: 'В продаже',
      reserved: 'Забронирован',
      sold: 'Продан',
      unknown: '',
    },
    powertrains: {
      petrol: 'Бензин',
      diesel: 'Дизель',
      hev: 'Гибрид',
      phev: 'Подключаемый гибрид',
      erev: 'С увеличителем запаса хода',
      bev: 'Электро',
      lpg: 'LPG',
      other: 'Другой двигатель',
      unknown: '—',
    },
    bodies: {
      hatchback: 'Хэтчбек',
      suv: 'Внедорожник',
      sedan: 'Седан',
      wagon: 'Универсал',
      coupe: 'Купе',
      convertible: 'Кабриолет',
      van: 'Фургон',
      pickup: 'Пикап',
      other: 'Другой кузов',
      unknown: '—',
    },
    transmissions: {
      manual: 'Механика',
      automatic: 'Автомат',
      cvt: 'Вариатор',
      dct: 'Робот с двойным сцеплением',
      other: 'Другая коробка',
      unknown: '—',
    },
    contactTelegram: 'Спросить в Telegram',
    contactWhatsapp: 'Спросить в WhatsApp',
    contactNote:
      'Данные автомобиля появятся в черновике чата. Проверьте и отправьте сообщение сами.',
    similar: 'Автомобиль продан — спросить о похожих',
    back: 'Вернуться к подборке',
    specifications: 'Данные автомобиля',
    estimate: 'Открыть калькулятор',
    estimateNote: 'Введите параметры автомобиля в калькулятор.',
    gallery: 'Посмотреть другие фотографии',
    inclusions: 'В цену входит',
    stale: 'Показаны более ранние данные. Уточните актуальный статус у нас.',
  },
} satisfies Record<Locale, VehicleCopy>;

export function publicVehicleMessages(locale: Locale): VehicleCopy {
  return messages[locale];
}
