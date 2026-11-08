import type { Locale } from '@/i18n/routing';

type DetailContent = {
  budgetTitle: string;
  budgetIntro: string;
  destination: string;
  fullCalculator: string;
  budgetNote: string;
  basicInformation: string;
  inquiry: string;
  mileage: string;
  publicDescription: string;
  consultTitle: string;
  consultBody: string;
  includes: string;
  sellerTitle: string;
  share: string;
  copied: string;
  copyFailed: string;
  save: string;
  unsave: string;
  gallery: string;
  previousImage: string;
  nextImage: string;
  openGallery: string;
  closeGallery: string;
  imageLoading: string;
  imageUnavailable: string;
  retryImage: string;
  imagePosition: (position: number, count: number) => string;
  showImage: (position: number) => string;
};

export const detailContent = {
  zh: {
    budgetTitle: '进口费用计算器',
    budgetIntro: '选择目的国，使用完整计算器核对进口税费。',
    destination: '目的国',
    fullCalculator: '打开完整计算器',
    budgetNote: '仅作参考测算。制造日期、排量或功率未知时，请补充确认；不把缺失费用按零计算。',
    basicInformation: '详细车辆信息',
    inquiry: '咨询编号',
    mileage: '里程',
    publicDescription: '车辆介绍',
    consultTitle: '咨询这辆车',
    consultBody: '通过聊天了解车况、运输方案与报价。',
    includes: '价格包含项目',
    sellerTitle: 'HD Auto Export 出口咨询',
    share: '分享',
    copied: '已复制详情链接',
    copyFailed: '请使用浏览器复制本页地址',
    save: '收藏此车辆资料',
    unsave: '取消收藏此车辆资料',
    gallery: '车辆照片',
    previousImage: '上一张照片',
    nextImage: '下一张照片',
    openGallery: '查看大图',
    closeGallery: '关闭照片查看器',
    imageLoading: '正在加载照片…',
    imageUnavailable: '这张照片暂时无法加载。',
    retryImage: '重新加载照片',
    imagePosition: (position, count) => `第 ${position} 张，共 ${count} 张`,
    showImage: (position) => `查看第 ${position} 张照片`,
  },
  en: {
    budgetTitle: 'Import cost calculator',
    budgetIntro: 'Choose a destination and review import charges in the full calculator.',
    destination: 'Destination',
    fullCalculator: 'Open full calculator',
    budgetNote:
      'Reference estimates only. Confirm missing manufacture dates, engine capacity or power; unknown costs are not treated as zero.',
    basicInformation: 'Detailed vehicle information',
    inquiry: 'Inquiry reference',
    mileage: 'Mileage',
    publicDescription: 'Vehicle description',
    consultTitle: 'Ask about this vehicle',
    consultBody: 'Discuss vehicle details, shipping options and pricing in chat.',
    includes: 'Price inclusions',
    sellerTitle: 'HD Auto Export consultation',
    share: 'Share',
    copied: 'Detail link copied',
    copyFailed: 'Use your browser to copy this page address',
    save: 'Save this vehicle information',
    unsave: 'Unsave this vehicle information',
    gallery: 'Vehicle photos',
    previousImage: 'Previous photo',
    nextImage: 'Next photo',
    openGallery: 'Open gallery',
    closeGallery: 'Close photo viewer',
    imageLoading: 'Loading photo…',
    imageUnavailable: 'This photo is temporarily unavailable.',
    retryImage: 'Retry photo',
    imagePosition: (position, count) => `Photo ${position} of ${count}`,
    showImage: (position) => `View photo ${position}`,
  },
  ru: {
    budgetTitle: 'Калькулятор ввоза',
    budgetIntro: 'Выберите страну и проверьте импортные платежи в полном калькуляторе.',
    destination: 'Страна назначения',
    fullCalculator: 'Открыть полный калькулятор',
    budgetNote:
      'Только предварительный расчёт. Уточните дату выпуска, объём или мощность, если они неизвестны; отсутствующие расходы не считаются нулевыми.',
    basicInformation: 'Подробная информация',
    inquiry: 'Номер для обращения',
    mileage: 'Пробег',
    publicDescription: 'Описание автомобиля',
    consultTitle: 'Узнать об автомобиле',
    consultBody: 'Обсудите автомобиль, доставку и стоимость в чате.',
    includes: 'Что включено в цену',
    sellerTitle: 'Консультация HD Auto Export',
    share: 'Поделиться',
    copied: 'Ссылка на автомобиль скопирована',
    copyFailed: 'Скопируйте адрес страницы средствами браузера',
    save: 'Сохранить информацию об автомобиле',
    unsave: 'Удалить информацию из избранного',
    gallery: 'Фотографии автомобиля',
    previousImage: 'Предыдущее фото',
    nextImage: 'Следующее фото',
    openGallery: 'Открыть галерею',
    closeGallery: 'Закрыть просмотр фото',
    imageLoading: 'Загрузка фото…',
    imageUnavailable: 'Эта фотография временно недоступна.',
    retryImage: 'Загрузить фото повторно',
    imagePosition: (position, count) => `Фото ${position} из ${count}`,
    showImage: (position) => `Открыть фото ${position}`,
  },
} satisfies Record<Locale, DetailContent>;
