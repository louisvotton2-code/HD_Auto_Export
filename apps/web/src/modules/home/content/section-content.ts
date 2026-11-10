import type { Locale } from '@/i18n/routing';

type SectionCopy = {
  popular: string;
  popularBody: string;
  modelScope: string;
  modelRecords: string;
  catalog: string;
  learn: string;
  previous: string;
  next: string;
  slide: string;
  pause: string;
  play: string;
  why: string;
  benefits: { title: string; body: string }[];
  process: string;
  steps: { title: string; bullets: string[] }[];
  conversations: string;
  conversationsAccent: string;
  conversationsBody: string;
  consultationLabel: string;
  questionLabel: string;
  answerLabel: string;
  open: string;
  close: string;
  chats: { title: string; questions: { question: string; answer: string }[] }[];
  tool: string;
  calculator: string;
  calculatorBody: string;
  calculate: string;
  countries: { name: string; slug: string; flag: string }[];
  ready: string;
  readyBody: string;
  phone: string;
  send: string;
  formHint: string;
  enquiryMessage: string;
  enquiryPhoneLabel: string;
  phoneFallback: string;
};

/** Public service information and purchase questions, independent of customer records. */
export const sectionContent: Record<Locale, SectionCopy> = {
  zh: {
    popular: '按车型浏览',
    popularBody: '按品牌和车型浏览，找到适合你的汽车。',
    modelScope: '查看车型配置与相关车源',
    modelRecords: '相关车源',
    catalog: '完整车源目录 →',
    learn: '了解更多 →',
    previous: '上一组车型',
    next: '下一组车型',
    slide: '查看车型',
    pause: '暂停轮播',
    play: '播放轮播',
    why: '为什么选择 HD Auto Export',
    benefits: [
      {
        title: '了解车辆情况',
        body: '沟通车型与配置需求，购车前确认可提供的检测、照片和视频资料。',
      },
      {
        title: '确认车辆信息',
        body: '了解车辆年份、里程和使用情况；具体历史记录以实际可获取资料为准。',
      },
      {
        title: '协商国际交付',
        body: '从中国采购到出口运输，按目的地与需求确认 CIF 或 FOB 交付方案。',
      },
    ],
    process: '购车流程',
    steps: [
      {
        title: '沟通购车需求',
        bullets: ['告知车型、预算与目的地', '讨论合适的车辆配置', '了解采购和出口流程'],
      },
      {
        title: '确认订单与合同',
        bullets: ['确认车辆和服务范围', '明确价格及付款安排', '按合同约定办理订单'],
      },
      {
        title: '选车与车辆确认',
        bullets: ['核对可用车辆资料', '沟通照片、视频及检测', '确认车况和采购安排'],
      },
      {
        title: '出口与国际运输',
        bullets: ['确认 CIF 或 FOB 条款', '协调出口及运输文件', '目的港费用与清关另行确认'],
      },
      {
        title: '车辆交付',
        bullets: ['按约定地点交接车辆', '核对车辆及交付文件', '了解当地登记要求'],
      },
    ],
    conversations: '客户沟通',
    conversationsAccent: '购车咨询',
    conversationsBody: '选车、车况、运输与费用，了解购车前需要确认的事项。点击查看完整问答。',
    consultationLabel: '汽车出口咨询',
    questionLabel: '常见问题',
    answerLabel: '服务说明',
    open: '查看完整问答',
    close: '关闭问答',
    chats: [
      {
        title: '选车咨询',
        questions: [
          {
            question: '选车时需要提供哪些信息？',
            answer: '请告知意向车型、预算、目的国和配置需求，便于沟通选车范围。',
          },
          {
            question: '可以对比不同车型吗？',
            answer: '可以按用途、配置和预算比较车型，再进一步核对相关车源资料。',
          },
        ],
      },
      {
        title: '车辆资料',
        questions: [
          {
            question: '购车前可以核对哪些车辆信息？',
            answer: '确认车辆年份、里程、配置和使用情况，并了解实际可获取的历史记录。',
          },
          {
            question: '可以查看照片、视频或检测资料吗？',
            answer: '我们会根据具体车源确认可提供的照片、视频和检测资料，并说明需要进一步核实的内容。',
          },
        ],
      },
      {
        title: '国际运输',
        questions: [
          {
            question: '可以选择 CIF 或 FOB 吗？',
            answer: '适合海运的订单可沟通 CIF 或 FOB，港口、运费和保险分工在报价及合同中确认。',
          },
          {
            question: '目的地清关由谁安排？',
            answer: '由买方或其委托代理办理进口清关。目的港费用、税费及登记要求需按目的地另行确认。',
          },
        ],
      },
      {
        title: '费用确认',
        questions: [
          {
            question: '车辆报价包含哪些费用？',
            answer: '车辆、运输、保险和进口费用按报价逐项确认，具体包含范围以双方约定为准。',
          },
          {
            question: '如何使用进口费用计算器？',
            answer: '输入车辆参数和目的国可先了解参考税费，最终金额以实际报价和海关认定为准。',
          },
        ],
      },
      {
        title: '文件准备',
        questions: [
          {
            question: '出口前需要准备哪些文件？',
            answer: '根据车辆、目的国、运输路线和合同，确认发票、出口及运输资料等所需文件。',
          },
          {
            question: '在哪里了解完整购车流程？',
            answer: '购车指南介绍从选车、订单确认到运输与交付的步骤，也可以直接联系我们沟通具体需求。',
          },
        ],
      },
      {
        title: '交付安排',
        questions: [
          {
            question: '车辆在哪里交付？',
            answer: '交付地点与运输方式在订单中确认，可结合实际路线沟通港口或其他交接地点。',
          },
          {
            question: '如何确认提车时间？',
            answer: '根据车辆准备、运输计划及清关安排沟通交付时间，以本次订单的实际进度为准。',
          },
        ],
      },
    ],
    tool: '在线工具',
    calculator: '提前了解进口税费',
    calculatorBody: '按车辆参数查看俄罗斯、哈萨克斯坦或乌兹别克斯坦的关税、增值税及其他费用参考。',
    calculate: '计算费用',
    countries: [
      { name: '俄罗斯', slug: 'russia', flag: '🇷🇺' },
      { name: '哈萨克斯坦', slug: 'kazakhstan', flag: '🇰🇿' },
      { name: '乌兹别克斯坦', slug: 'uzbekistan', flag: '🇺🇿' },
    ],
    ready: '准备好寻找你的汽车了吗？',
    readyBody: '告诉我们你的预算与需求，一起了解中国车源和出口方案。',
    phone: '你的电话号码',
    send: '通过 WhatsApp 继续咨询',
    formHint: '在 WhatsApp 中确认咨询信息后发送。',
    enquiryMessage: '您好，我想咨询从中国购车出口。',
    enquiryPhoneLabel: '联系电话',
    phoneFallback: '打开 WhatsApp 后，请补充联系电话并发送咨询信息。',
  },
  en: {
    popular: 'Browse by Model',
    popularBody: 'Explore models and find the right car for you.',
    modelScope: 'Explore specifications and related listings',
    modelRecords: 'Related listings',
    catalog: 'Full catalog →',
    learn: 'Learn more →',
    previous: 'Previous models',
    next: 'Next models',
    slide: 'View model',
    pause: 'Pause carousel',
    play: 'Play carousel',
    why: 'Why HD Auto Export',
    benefits: [
      {
        title: 'Vehicle Information',
        body: 'Discuss the model and specification you need, and confirm available inspections, photos and videos before purchase.',
      },
      {
        title: 'History & Condition',
        body: 'Review the year, mileage and condition. Vehicle history depends on the records available for each car.',
      },
      {
        title: 'International Delivery',
        body: 'Plan the purchase and export from China, with CIF or FOB terms agreed for your destination.',
      },
    ],
    process: 'Buying Process',
    steps: [
      {
        title: 'Discuss Your Requirements',
        bullets: [
          'Share your budget and destination',
          'Discuss models and specifications',
          'Understand the purchase and export process',
        ],
      },
      {
        title: 'Confirm the Agreement',
        bullets: [
          'Agree on the vehicle and service scope',
          'Confirm prices and payment terms',
          'Proceed according to the contract',
        ],
      },
      {
        title: 'Select & Confirm the Car',
        bullets: [
          'Review available vehicle information',
          'Discuss photos, videos and inspection',
          'Confirm condition and purchase arrangements',
        ],
      },
      {
        title: 'Export & International Shipping',
        bullets: [
          'Agree on CIF or FOB terms',
          'Coordinate export and shipping documents',
          'Confirm destination fees and clearance separately',
        ],
      },
      {
        title: 'Vehicle Handover',
        bullets: [
          'Receive the car at the agreed location',
          'Check the vehicle and documents',
          'Confirm local registration requirements',
        ],
      },
    ],
    conversations: 'Purchase',
    conversationsAccent: 'Consultation',
    conversationsBody: 'From choosing a car to shipping and costs, explore the details to confirm before buying. Open a topic to read more.',
    consultationLabel: 'Vehicle export consultation',
    questionLabel: 'Your questions',
    answerLabel: 'Our service',
    open: 'Read the full answers',
    close: 'Close answers',
    chats: [
      {
        title: 'Choosing a car',
        questions: [
          {
            question: 'What information helps with choosing a car?',
            answer: 'Share your preferred model, budget, destination and specifications so we can discuss suitable options.',
          },
          {
            question: 'Can I compare different models?',
            answer: 'Compare models by use, equipment and budget, then review the information available for the relevant vehicles.',
          },
        ],
      },
      {
        title: 'Vehicle information',
        questions: [
          {
            question: 'What vehicle information can I review before buying?',
            answer: 'Check the year, mileage, specifications and condition, along with the history records available for the car.',
          },
          {
            question: 'Can I see photos, videos or inspection information?',
            answer: 'We confirm which photos, videos and inspection records are available for each vehicle, and identify details that need further verification.',
          },
        ],
      },
      {
        title: 'International shipping',
        questions: [
          {
            question: 'Can I choose CIF or FOB?',
            answer: 'For suitable sea shipments, discuss CIF or FOB. Ports, freight and insurance responsibilities are confirmed in the quotation and agreement.',
          },
          {
            question: 'Who arranges destination clearance?',
            answer: 'The buyer or an appointed broker handles import clearance. Confirm destination charges, taxes and registration requirements separately.',
          },
        ],
      },
      {
        title: 'Understanding costs',
        questions: [
          {
            question: 'Which costs are included in a quotation?',
            answer: 'Confirm vehicle, shipping, insurance and import costs individually. The agreed quotation defines what is included.',
          },
          {
            question: 'How can I use the import cost calculator?',
            answer: 'Enter the vehicle details and destination for indicative import charges. Final amounts depend on the actual quotation and customs assessment.',
          },
        ],
      },
      {
        title: 'Preparing documents',
        questions: [
          {
            question: 'Which documents are needed for export?',
            answer: 'Confirm invoices, export and shipping documents for the vehicle, destination, route and agreed delivery terms.',
          },
          {
            question: 'Where can I learn about the full buying process?',
            answer: 'The buying guide covers vehicle selection, order confirmation, shipping and handover. You can also contact us to discuss your requirements.',
          },
        ],
      },
      {
        title: 'Planning delivery',
        questions: [
          {
            question: 'Where is the vehicle handed over?',
            answer: 'The order defines the handover location and transport arrangements, including a port or another agreed delivery point.',
          },
          {
            question: 'How is the delivery schedule confirmed?',
            answer: 'Discuss timing based on vehicle preparation, transport and clearance arrangements. The schedule follows the progress of your order.',
          },
        ],
      },
    ],
    tool: 'Online Tool',
    calculator: 'Calculate customs duties in advance',
    calculatorBody:
      'Explore indicative duties, VAT and other import costs for Russia, Kazakhstan or Uzbekistan using your vehicle details.',
    calculate: 'Calculate cost',
    countries: [
      { name: 'Russia', slug: 'russia', flag: '🇷🇺' },
      { name: 'Kazakhstan', slug: 'kazakhstan', flag: '🇰🇿' },
      { name: 'Uzbekistan', slug: 'uzbekistan', flag: '🇺🇿' },
    ],
    ready: 'Ready to find your car?',
    readyBody: 'Tell us your budget and preferences to explore cars from China and export options.',
    phone: 'Your phone number',
    send: 'Continue on WhatsApp',
    formHint: 'Review your enquiry in WhatsApp before sending.',
    enquiryMessage: 'Hello, I would like to discuss buying and exporting a vehicle from China.',
    enquiryPhoneLabel: 'My contact number',
    phoneFallback: 'Add your contact number in WhatsApp, then send your enquiry.',
  },
  ru: {
    popular: 'Поиск по моделям',
    popularBody: 'Выберите модель под ваши задачи и бюджет.',
    modelScope: 'Комплектации и предложения по модели',
    modelRecords: 'Предложения',
    catalog: 'Весь каталог →',
    learn: 'Подробнее →',
    previous: 'Предыдущие модели',
    next: 'Следующие модели',
    slide: 'Посмотреть модель',
    pause: 'Остановить прокрутку',
    play: 'Включить прокрутку',
    why: 'Почему HD Auto Export',
    benefits: [
      {
        title: 'Информация об автомобиле',
        body: 'Обсудим модель и комплектацию, уточним доступные осмотры, фото и видео до покупки.',
      },
      {
        title: 'История и состояние',
        body: 'Уточним год, пробег и состояние. История автомобиля зависит от доступных документов.',
      },
      {
        title: 'Международная доставка',
        body: 'Согласуем покупку и экспорт из Китая на условиях CIF или FOB с учётом направления.',
      },
    ],
    process: 'Процесс покупки',
    steps: [
      {
        title: 'Обсудите ваши пожелания',
        bullets: [
          'Укажите бюджет и страну назначения',
          'Обсудите модели и комплектации',
          'Узнайте порядок покупки и экспорта',
        ],
      },
      {
        title: 'Согласуйте договор',
        bullets: [
          'Уточните автомобиль и объём услуг',
          'Согласуйте цену и порядок оплаты',
          'Оформите заказ по условиям договора',
        ],
      },
      {
        title: 'Выберите автомобиль',
        bullets: [
          'Проверьте доступные сведения',
          'Обсудите фото, видео и осмотр',
          'Подтвердите состояние и покупку',
        ],
      },
      {
        title: 'Экспорт и перевозка',
        bullets: [
          'Согласуйте условия CIF или FOB',
          'Подготовьте экспортные документы',
          'Отдельно уточните таможню и сборы',
        ],
      },
      {
        title: 'Получите автомобиль',
        bullets: [
          'Получите авто в согласованном месте',
          'Проверьте автомобиль и документы',
          'Уточните местные правила регистрации',
        ],
      },
    ],
    conversations: 'Консультации',
    conversationsAccent: 'по покупке',
    conversationsBody: 'Выбор автомобиля, состояние, доставка и расходы — узнайте, что важно согласовать до покупки. Откройте тему, чтобы прочитать ответы.',
    consultationLabel: 'Консультация по экспорту авто',
    questionLabel: 'Частый вопрос',
    answerLabel: 'Наши услуги',
    open: 'Прочитать ответы',
    close: 'Закрыть ответы',
    chats: [
      {
        title: 'Выбор автомобиля',
        questions: [
          {
            question: 'Какие данные помогут подобрать автомобиль?',
            answer: 'Укажите желаемую модель, бюджет, страну назначения и комплектацию — обсудим подходящие варианты.',
          },
          {
            question: 'Можно сравнить разные модели?',
            answer: 'Сравните модели по назначению, оснащению и бюджету, затем уточните доступные сведения о конкретных автомобилях.',
          },
        ],
      },
      {
        title: 'Сведения об автомобиле',
        questions: [
          {
            question: 'Что можно проверить перед покупкой?',
            answer: 'Уточните год, пробег, комплектацию и состояние, а также доступные документы об истории автомобиля.',
          },
          {
            question: 'Можно получить фото, видео и результаты осмотра?',
            answer: 'По каждому автомобилю согласуем доступные фото, видео и сведения об осмотре. Отдельно укажем данные, которые ещё нужно проверить.',
          },
        ],
      },
      {
        title: 'Международная доставка',
        questions: [
          {
            question: 'Можно выбрать CIF или FOB?',
            answer: 'Для подходящей морской перевозки можно согласовать CIF или FOB. Порты, фрахт и страхование уточняются в предложении и договоре.',
          },
          {
            question: 'Кто оформляет импорт в стране назначения?',
            answer: 'Импорт оформляет покупатель или его брокер. Портовые расходы, налоги и требования к регистрации уточняются отдельно.',
          },
        ],
      },
      {
        title: 'Расходы и стоимость',
        questions: [
          {
            question: 'Какие расходы включены в предложение?',
            answer: 'Стоимость автомобиля, перевозку, страхование и импортные расходы согласуем по отдельным позициям. Состав цены фиксируется в предложении.',
          },
          {
            question: 'Как пользоваться калькулятором ввоза?',
            answer: 'Введите параметры автомобиля и страну назначения для предварительной оценки платежей. Итог зависит от предложения и расчёта таможни.',
          },
        ],
      },
      {
        title: 'Подготовка документов',
        questions: [
          {
            question: 'Какие документы нужны для экспорта?',
            answer: 'Перечень счетов, экспортных и транспортных документов согласуется с учётом автомобиля, страны, маршрута и условий поставки.',
          },
          {
            question: 'Где узнать весь порядок покупки?',
            answer: 'Руководство описывает выбор автомобиля, подтверждение заказа, перевозку и получение. Конкретные пожелания можно обсудить с нами напрямую.',
          },
        ],
      },
      {
        title: 'Передача автомобиля',
        questions: [
          {
            question: 'Где передают автомобиль?',
            answer: 'Место передачи и способ перевозки определяются заказом: порт или другой согласованный пункт с учётом маршрута.',
          },
          {
            question: 'Как согласовать дату получения?',
            answer: 'Срок обсуждается с учётом подготовки автомобиля, перевозки и оформления. Ориентируйтесь на фактический ход вашего заказа.',
          },
        ],
      },
    ],
    tool: 'Онлайн-инструмент',
    calculator: 'Рассчитайте таможенные платежи заранее',
    calculatorBody:
      'Оцените пошлины, НДС и другие импортные расходы для России, Казахстана или Узбекистана по параметрам автомобиля.',
    calculate: 'Рассчитать стоимость',
    countries: [
      { name: 'Россия', slug: 'russia', flag: '🇷🇺' },
      { name: 'Казахстан', slug: 'kazakhstan', flag: '🇰🇿' },
      { name: 'Узбекистан', slug: 'uzbekistan', flag: '🇺🇿' },
    ],
    ready: 'Готовы найти свой автомобиль?',
    readyBody:
      'Расскажите о бюджете и пожеланиях — обсудим автомобили из Китая и варианты экспорта.',
    phone: 'Ваш номер телефона',
    send: 'Написать в WhatsApp',
    formHint: 'Проверьте текст обращения в WhatsApp перед отправкой.',
    enquiryMessage: 'Здравствуйте! Хочу обсудить покупку и экспорт автомобиля из Китая.',
    enquiryPhoneLabel: 'Мой контактный номер',
    phoneFallback: 'Добавьте контактный номер в WhatsApp и отправьте обращение.',
  },
};
