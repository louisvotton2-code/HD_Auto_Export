import type { Locale } from '@/i18n/routing';

type SectionCopy = {
  popular: string;
  popularBody: string;
  catalog: string;
  learn: string;
  demo: string;
  price: string;
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
  chatDemo: string;
  chatContact: string;
  chatToday: string;
  open: string;
  close: string;
  chats: { title: string; messages: { text: string; fromCompany: boolean }[] }[];
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
  formNotice: string;
  whatsapp: string;
};

/** Local demonstration content only. These conversations are fictional, never testimonials. */
export const sectionContent: Record<Locale, SectionCopy> = {
  zh: {
    popular: '热门车型',
    popularBody: '了解车型、配置与演示车源',
    catalog: '完整车源目录 →',
    learn: '了解更多 →',
    demo: '演示车源',
    price: '示例车价',
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
    conversationsAccent: '演示',
    conversationsBody: '以下为虚构商务对话，展示沟通方式，不是真实客户评价。点击可放大阅读。',
    chatDemo: '虚构对话 · 演示',
    chatContact: '购车咨询 · 演示',
    chatToday: '沟通示例',
    open: '放大查看',
    close: '关闭对话',
    chats: [
      {
        title: '选车咨询 · 演示',
        messages: [
          { text: '你好，我想了解适合家庭使用的 SUV。', fromCompany: false },
          { text: '你好！请告诉我们预算、目的地和配置需求。', fromCompany: true },
          { text: '想先看看几款车型和车辆资料。', fromCompany: false },
          { text: '可以，我们可以先沟通车型，再核对实际可提供的车辆信息。', fromCompany: true },
        ],
      },
      {
        title: '车况资料 · 演示',
        messages: [
          { text: '确认购买前能了解哪些车辆信息？', fromCompany: false },
          { text: '可以先核对年份、里程、照片和可获取的检测资料。', fromCompany: true },
          { text: '也想了解视频和历史记录。', fromCompany: false },
          { text: '我们会按具体车辆确认资料，未核实的信息会单独说明。', fromCompany: true },
        ],
      },
      {
        title: '国际配送 · 演示',
        messages: [
          { text: '国际运输可以选择 FOB 吗？', fromCompany: false },
          { text: '可以沟通 FOB 或 CIF，具体港口与费用需要逐项确认。', fromCompany: true },
          { text: '目的港清关由谁安排？', fromCompany: false },
          { text: '清关与登记责任会在报价和合同中明确。', fromCompany: true },
        ],
      },
      {
        title: '费用确认 · 演示',
        messages: [
          { text: '网页里的车价包含全部落地费用吗？', fromCompany: false },
          { text: '页面是演示价格。实际车价、运输和进口费用需要分别核实。', fromCompany: true },
          { text: '我可以先用计算器看一下吗？', fromCompany: false },
          { text: '可以作为费用参考，正式金额仍以实际报价及海关认定为准。', fromCompany: true },
        ],
      },
      {
        title: '文件准备 · 演示',
        messages: [
          { text: '出口前需要确认哪些文件？', fromCompany: false },
          { text: '会按车辆、目的地及合同确认所需文件清单。', fromCompany: true },
          { text: '我想先了解整个流程。', fromCompany: false },
          { text: '可以查看购车指南，再把你的具体需求告诉我们。', fromCompany: true },
        ],
      },
      {
        title: '交付安排 · 演示',
        messages: [
          { text: '车辆在哪里交付？', fromCompany: false },
          { text: '交付地点和运输方式需要在订单中明确约定。', fromCompany: true },
          { text: '可以一起确认时间安排吗？', fromCompany: false },
          { text: '可以，我们会按实际车辆和运输计划沟通，时间以最终安排为准。', fromCompany: true },
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
    send: '发送',
    formHint: '本地演示表单，不会发送或保存号码。',
    formNotice: '此表单为本地演示，号码尚未提交。请通过 WhatsApp 与我们联系。',
    whatsapp: '通过 WhatsApp 联系',
  },
  en: {
    popular: 'Popular Models',
    popularBody: 'Models, specifications and demo listings',
    catalog: 'Full catalog →',
    learn: 'Learn more →',
    demo: 'Demo listing',
    price: 'Example vehicle price',
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
    conversations: 'Client',
    conversationsAccent: 'Conversations',
    conversationsBody:
      'Fictional business conversations showing the communication format. These are demos, not client reviews. Tap to enlarge.',
    chatDemo: 'Fictional conversation · Demo',
    chatContact: 'Vehicle enquiry · Demo',
    chatToday: 'Conversation example',
    open: 'Enlarge conversation',
    close: 'Close conversation',
    chats: [
      {
        title: 'Choosing a car · Demo',
        messages: [
          { text: 'Hello, I am looking for a family SUV.', fromCompany: false },
          {
            text: 'Hello! What is your budget, destination and preferred specification?',
            fromCompany: true,
          },
          { text: 'I would like to compare a few models first.', fromCompany: false },
          {
            text: 'Of course. We can discuss the models and then check the available vehicle information.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Vehicle information · Demo',
        messages: [
          { text: 'What can I check before confirming a purchase?', fromCompany: false },
          {
            text: 'We can review the year, mileage, photos and any available inspection information.',
            fromCompany: true,
          },
          { text: 'I would also like videos and history records.', fromCompany: false },
          {
            text: 'We will confirm what is available for the actual car and identify anything unverified.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'International shipping · Demo',
        messages: [
          { text: 'Can we arrange shipping on FOB terms?', fromCompany: false },
          {
            text: 'We can discuss FOB or CIF and confirm the ports and fees individually.',
            fromCompany: true,
          },
          { text: 'Who arranges clearance at the destination?', fromCompany: false },
          {
            text: 'Clearance and registration responsibilities will be set out in the quotation and agreement.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Understanding costs · Demo',
        messages: [
          { text: 'Does the price on the website include every landed cost?', fromCompany: false },
          {
            text: 'These are demo prices. The actual vehicle, shipping and import costs need separate confirmation.',
            fromCompany: true,
          },
          { text: 'Can I try the calculator first?', fromCompany: false },
          {
            text: 'Yes, as an estimate. Final amounts depend on the quotation and customs assessment.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Preparing documents · Demo',
        messages: [
          { text: 'Which export documents should we prepare?', fromCompany: false },
          {
            text: 'We will confirm the list for your vehicle, destination and agreement.',
            fromCompany: true,
          },
          { text: 'I would like to understand the process first.', fromCompany: false },
          {
            text: 'Our buying guide explains the steps. You can then tell us your requirements.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Planning delivery · Demo',
        messages: [
          { text: 'Where will the vehicle be handed over?', fromCompany: false },
          {
            text: 'The handover location and shipping arrangements will be agreed in the order.',
            fromCompany: true,
          },
          { text: 'Can we discuss the schedule as well?', fromCompany: false },
          {
            text: 'Yes. Timing will be confirmed for the actual car and transport plan.',
            fromCompany: true,
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
    send: 'Send',
    formHint: 'Local demo form. Your number will not be sent or saved.',
    formNotice:
      'This is a local demo. Your number has not been submitted. Please contact us on WhatsApp.',
    whatsapp: 'Contact on WhatsApp',
  },
  ru: {
    popular: 'Популярные модели',
    popularBody: 'Модели, характеристики и демо-объявления',
    catalog: 'Весь каталог →',
    learn: 'Подробнее →',
    demo: 'Демо-объявление',
    price: 'Пример цены автомобиля',
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
    conversations: 'Общение',
    conversationsAccent: 'с клиентами',
    conversationsBody:
      'Вымышленные деловые диалоги для демонстрации формата общения. Это не отзывы клиентов. Нажмите для увеличения.',
    chatDemo: 'Вымышленный диалог · Демо',
    chatContact: 'Подбор автомобиля · Демо',
    chatToday: 'Пример общения',
    open: 'Увеличить диалог',
    close: 'Закрыть диалог',
    chats: [
      {
        title: 'Выбор автомобиля · Демо',
        messages: [
          { text: 'Здравствуйте! Ищу семейный кроссовер.', fromCompany: false },
          {
            text: 'Здравствуйте! Уточните бюджет, страну назначения и комплектацию.',
            fromCompany: true,
          },
          { text: 'Хочу сначала сравнить несколько моделей.', fromCompany: false },
          {
            text: 'Конечно. Обсудим модели, затем проверим доступные сведения об автомобилях.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Состояние автомобиля · Демо',
        messages: [
          { text: 'Какие сведения можно проверить до покупки?', fromCompany: false },
          { text: 'Год, пробег, фотографии и доступные результаты осмотра.', fromCompany: true },
          { text: 'Также нужны видео и история автомобиля.', fromCompany: false },
          {
            text: 'Уточним данные по конкретному авто и отдельно отметим непроверенные сведения.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Международная доставка · Демо',
        messages: [
          { text: 'Можно организовать перевозку на условиях FOB?', fromCompany: false },
          {
            text: 'Можно обсудить FOB или CIF. Порты и расходы согласуем отдельно.',
            fromCompany: true,
          },
          { text: 'Кто занимается таможней в стране назначения?', fromCompany: false },
          {
            text: 'Обязанности по оформлению и регистрации определим в предложении и договоре.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Расчёт расходов · Демо',
        messages: [
          { text: 'Цена на сайте включает все расходы?', fromCompany: false },
          {
            text: 'Это демо-цены. Стоимость авто, перевозки и импорта нужно уточнять отдельно.',
            fromCompany: true,
          },
          { text: 'Можно сначала воспользоваться калькулятором?', fromCompany: false },
          {
            text: 'Да, для ориентировочной оценки. Итог зависит от предложения и расчёта таможни.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Подготовка документов · Демо',
        messages: [
          { text: 'Какие документы нужны для экспорта?', fromCompany: false },
          {
            text: 'Перечень зависит от автомобиля, страны назначения и договора.',
            fromCompany: true,
          },
          { text: 'Сначала хочу узнать весь процесс.', fromCompany: false },
          {
            text: 'Посмотрите руководство по покупке, а затем расскажите о ваших требованиях.',
            fromCompany: true,
          },
        ],
      },
      {
        title: 'Планирование передачи · Демо',
        messages: [
          { text: 'Где можно будет получить автомобиль?', fromCompany: false },
          {
            text: 'Место передачи и перевозку согласуем при оформлении заказа.',
            fromCompany: true,
          },
          { text: 'Можно также обсудить сроки?', fromCompany: false },
          {
            text: 'Да. Сроки уточняются по конкретному автомобилю и плану перевозки.',
            fromCompany: true,
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
    send: 'Отправить',
    formHint: 'Локальная демо-форма. Номер не отправляется и не сохраняется.',
    formNotice: 'Это локальная демо-форма. Номер не отправлен. Свяжитесь с нами через WhatsApp.',
    whatsapp: 'Написать в WhatsApp',
  },
};
