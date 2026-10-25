/** Buying guidance is content only; it does not create orders or accept payments. */
const en = {
  navLabel: 'How to buy',
  metaTitle: 'How to buy a car from China',
  metaDescription:
    'Explore the HD Auto Export buying process: vehicle selection, condition checks, export preparation, CIF or FOB shipping, and collection at your destination.',
  eyebrow: 'CHINA TO YOUR DESTINATION',
  title: 'Your next car.',
  titleAccent: 'A clear way to get there.',
  description:
    'From choosing a vehicle in China to collecting it at your destination. Follow the process, agree the details, and know what comes next.',
  heroContact: 'Discuss your car',
  heroSteps: 'Explore the 8 steps',
  overviewSteps: 'Steps from selection to collection',
  overviewDeposit: 'Deposit credited toward your car',
  overviewTerms: 'Ocean shipping options',
  processLabel: 'THE BUYING PROCESS',
  processTitle: 'One step at a time.',
  processDescription:
    'Vehicle details, payment terms and delivery responsibilities are agreed before you move ahead.',
  stepLabel: 'Step {number}',
  steps: {
    choose: {
      title: 'Choose your car',
      body: 'Tell us your preferred model, budget and destination. We will discuss available options and the import requirements that need to be checked before purchase.',
      note: 'Start with your requirements or send us a vehicle you are considering.',
    },
    deposit: {
      title: 'Confirm the order',
      body: 'Once the vehicle and order details are agreed, pay a USD {deposit} reservation deposit. This amount is credited toward the vehicle price.',
      note: 'Reservation, cancellation and refund conditions follow the order or contract confirmed by both parties.',
    },
    inspection: {
      title: 'Review the vehicle condition',
      body: 'Confirm the vehicle details and the agreed inspection items. Review the available photos, videos and condition information before deciding to proceed.',
      note: 'The inspection scope and how any findings are handled are agreed for your order.',
    },
    balance: {
      title: 'Pay the remaining balance',
      body: 'After confirming the vehicle condition and final invoice, pay the remaining amount according to the agreed order or contract. The USD {deposit} deposit is deducted from the vehicle price.',
      note: 'Confirm the payee, amount, currency and payment schedule before transferring funds.',
    },
    export: {
      title: 'Prepare for export',
      body: 'After purchase is confirmed, we coordinate the agreed export preparation in China and check the invoice, export and transport documents required for the shipment.',
      note: 'Document requirements depend on the vehicle, destination and agreed delivery terms.',
    },
    shipping: {
      title: 'Arrange international shipping',
      body: 'Choose CIF or FOB for a suitable sea shipment. We agree the ports, route, freight and insurance responsibilities before dispatch.',
      note: 'Rail, road and multimodal routes need separately agreed delivery terms. Transit times depend on the actual route and schedule.',
    },
    customs: {
      title: 'Complete import clearance',
      body: 'At the destination, you or your appointed broker arrange import clearance and the applicable local payments. We provide the export-side documents agreed for the order.',
      note: 'Use the calculator for a reference estimate; local duties, eligibility and final costs need separate confirmation.',
    },
    receive: {
      title: 'Collect your car',
      body: 'Once clearance and release are complete, arrange collection at the agreed location. Check the vehicle, keys and documents during handover.',
      note: 'Confirm local registration requirements before driving on public roads.',
    },
  },
  termsEyebrow: 'YOUR SHIPPING OPTIONS',
  termsTitle: 'CIF or FOB. Choose what works for you.',
  termsDescription:
    'For a suitable sea shipment, agree the named ports and Incoterms® 2020 in your contract. Road, rail and multimodal journeys need terms suited to the route.',
  cifTitle: 'CIF · Cost, Insurance and Freight',
  cifBody:
    'Prefer us to arrange the sea leg? Under CIF, the seller contracts the freight and cargo insurance to the named destination port.',
  cifPoints: {
    freight: 'Seller arranges and pays the agreed sea freight.',
    insurance:
      'Seller arranges cargo insurance; confirm its cover, limits and exclusions in the order.',
    customs: 'Buyer handles import clearance and duties; confirm destination charges separately.',
  },
  fobTitle: 'FOB · Free On Board',
  fobBody:
    'Have your own shipping arrangement? Under FOB, the seller delivers the vehicle on board the vessel nominated by the buyer at the named shipment port.',
  fobPoints: {
    freight: 'Buyer arranges and pays for the main sea carriage.',
    insurance: 'Insurance is not included by default; the buyer arranges any required cover.',
    customs: 'Seller handles export clearance; buyer handles import clearance and duties.',
  },
  riskNote:
    'For both CIF and FOB, risk normally passes to the buyer when the vehicle is on board at the shipment port. CIF payment of freight to the destination does not extend that risk point to arrival. Confirm the applicable terms in your contract.',
  faqEyebrow: 'A FEW THINGS TO KNOW',
  faqTitle: 'Before you get started.',
  faqDescription: 'The details that help you plan your purchase.',
  faq: {
    destinations: {
      question: 'Which destinations can I ask about?',
      answer:
        'Ask us about Russia, Kazakhstan, Uzbekistan, Georgia, Armenia, Kyrgyzstan or Albania. For these and other destinations, we confirm the route and vehicle import requirements for your order before proceeding.',
    },
    deposit: {
      question: 'How is the reservation deposit used?',
      answer:
        'It is credited toward the vehicle price, rather than charged as an additional service fee. Reservation periods, payment deadlines, cancellation and refund conditions are set out in the order or contract agreed by both parties.',
    },
    customs: {
      question: 'Who handles clearance and local costs?',
      answer:
        'You or your appointed broker handle destination import clearance. Confirm duties, port charges, registration and any local delivery costs separately. Our calculator provides a reference estimate, not a final customs bill or a complete landed price.',
    },
    insurance: {
      question: 'Is transport insurance included?',
      answer:
        'For CIF sea shipments, the seller arranges cargo insurance under the agreed terms; review the policy cover and exclusions before shipment. FOB does not include seller-arranged insurance by default. For other routes, insurance is confirmed separately.',
    },
  },
  ctaEyebrow: 'START WITH A CONVERSATION',
  ctaTitle: 'Tell us what you want to drive.',
  ctaDescription:
    'Send your preferred model, budget and destination to HD Auto Export. We can discuss the next steps and a delivery arrangement that fits your purchase.',
  ctaContact: 'Contact HD Auto Export',
  ctaCalculator: 'Estimate import fees',
} as const;

type MessageShape<T> = {
  [Key in keyof T]: T[Key] extends string ? string : MessageShape<T[Key]>;
};

export type BuyingGuideMessages = MessageShape<typeof en>;

const zh: BuyingGuideMessages = {
  navLabel: '如何购车',
  metaTitle: '如何从中国购车出口',
  metaDescription:
    '了解 HD Auto Export 中国购车出口流程：选车、车况确认、出口手续、CIF 或 FOB 国际海运，以及目的地清关与提车。',
  eyebrow: '从中国，驶向你的目的地',
  title: '下一辆爱车，',
  titleAccent: '每一步都清楚。',
  description: '从中国选车，到目的地提车。先了解流程，再确认细节，让每一步都有方向。',
  heroContact: '聊聊你的购车需求',
  heroSteps: '了解购车 8 步',
  overviewSteps: '从选车到提车的流程',
  overviewDeposit: '预订定金，可抵车款',
  overviewTerms: '海运交付方式可选',
  processLabel: '购车流程',
  processTitle: '把购车，分成清晰的每一步。',
  processDescription: '车辆信息、付款条件和交付分工，都在推进前逐项确认。',
  stepLabel: '第 {number} 步',
  steps: {
    choose: {
      title: '确定心仪车辆',
      body: '告诉我们意向车型、预算和目的国，一起确认可选车辆，并核对购买前需要了解的进口要求。',
      note: '可以先说需求，也可以把正在考虑的车辆发给我们。',
    },
    deposit: {
      title: '确认订单',
      body: '车辆与订单细节确认后，支付 {deposit} 美元预订定金。这笔金额计入车款，支付尾款时抵扣。',
      note: '车辆预留、取消及退还条件，以双方确认的订单或合同为准。',
    },
    inspection: {
      title: '检查并确认车况',
      body: '核对车辆信息及已约定的检查项目，查看可提供的照片、视频和车况资料，再决定是否继续购买。',
      note: '检查范围及发现问题后的处理方式，在订单中具体约定。',
    },
    balance: {
      title: '支付剩余款项',
      body: '确认车况和最终账单后，按约定的订单或合同支付剩余款项。已付的 {deposit} 美元定金从车款中抵扣。',
      note: '付款前核对收款方、金额、币种和付款节点。',
    },
    export: {
      title: '办理出口手续',
      body: '采购确认后，按约定协调中国境内的出口准备，核对本次运输需要的发票、出口及运输资料。',
      note: '所需文件随车辆、目的国和交付条款而不同。',
    },
    shipping: {
      title: '安排国际运输',
      body: '适合海运的订单可选择 CIF 或 FOB，发运前确认港口、路线，以及运费和保险的责任分工。',
      note: '铁路、公路及多式联运另行确认交付条款；运输时间以实际路线和班期为准。',
    },
    customs: {
      title: '完成目的地清关',
      body: '到达目的地后，由你或委托的代理办理进口清关及当地缴费，我们提供订单约定的出口端资料。',
      note: '计算器可辅助估算，实际税费、进口资格和最终费用需另行确认。',
    },
    receive: {
      title: '提取你的爱车',
      body: '完成清关和放行后，在约定地点安排提车，交接时核对车辆、钥匙及随车文件。',
      note: '上路前，请按当地要求确认车辆登记等手续。',
    },
  },
  termsEyebrow: '国际运输，按需选择',
  termsTitle: 'CIF 或 FOB，由你选择。',
  termsDescription:
    '适合海运的订单，在合同中约定具体港口及 Incoterms® 2020。公路、铁路及多式联运，另行选择适合实际路线的条款。',
  cifTitle: 'CIF · 成本、保险费加运费',
  cifBody: '希望由我们安排海运段？CIF 由卖方安排至指定目的港的运输，并办理货运保险。',
  cifPoints: {
    freight: '卖方安排并支付约定的海运运费。',
    insurance: '卖方办理货运保险，保障范围、限额及除外责任在订单中确认。',
    customs: '买方负责进口清关及税费，目的港费用另行核对。',
  },
  fobTitle: 'FOB · 装运港船上交货',
  fobBody: '已有自己的运输安排？FOB 由卖方在指定装运港，将车辆交到买方指定的船上。',
  fobPoints: {
    freight: '买方安排并支付海运主运输段费用。',
    insurance: '默认不含卖方代办保险，所需保险由买方安排。',
    customs: '卖方负责出口清关，买方负责进口清关及税费。',
  },
  riskNote:
    'CIF 和 FOB 通常均在车辆于装运港装上船时，将风险转移给买方。CIF 支付运费至目的港，并不表示风险到港才转移；具体适用条款请在合同中确认。',
  faqEyebrow: '购车前，先了解',
  faqTitle: '你可能还想知道。',
  faqDescription: '把关键细节聊清楚，再开始下一步。',
  faq: {
    destinations: {
      question: '可以咨询哪些目的国？',
      answer:
        '可以先咨询俄罗斯、哈萨克斯坦、乌兹别克斯坦、格鲁吉亚、亚美尼亚、吉尔吉斯斯坦和阿尔巴尼亚。这些及其他目的地的实际路线、车辆准入条件，均在订单推进前逐项确认。',
    },
    deposit: {
      question: '预订定金如何使用？',
      answer:
        '定金计入车款，不是额外收取的服务费。车辆预留时间、付款期限、取消及退还条件，以双方确认的订单或合同为准。',
    },
    customs: {
      question: '谁负责清关和当地费用？',
      answer:
        '目的地进口清关由你或委托的代理办理。税费、港口费用、登记和当地运输等费用需要单独确认。本站计算器只提供参考估算，不是最终海关账单或完整落地价。',
    },
    insurance: {
      question: '国际运输是否包含保险？',
      answer:
        'CIF 海运由卖方按约定办理货运保险，发运前请核对保单保障范围及除外责任。FOB 默认不包含卖方代办保险；其他运输路线的保险安排另行确认。',
    },
  },
  ctaEyebrow: '从一次沟通开始',
  ctaTitle: '说说你想开的那辆车。',
  ctaDescription:
    '把意向车型、预算和目的地发给 HD Auto Export，一起确认下一步，以及适合这次购车的交付安排。',
  ctaContact: '联系 HD Auto Export',
  ctaCalculator: '估算进口费用',
};

const ru: BuyingGuideMessages = {
  navLabel: 'Как купить',
  metaTitle: 'Как купить автомобиль из Китая',
  metaDescription:
    'Покупка с HD Auto Export: выбор автомобиля, проверка состояния, подготовка экспорта, морская доставка CIF или FOB, таможня и получение.',
  eyebrow: 'ИЗ КИТАЯ В ВАШУ СТРАНУ',
  title: 'Ваш следующий автомобиль.',
  titleAccent: 'Понятный путь к покупке.',
  description:
    'От выбора автомобиля в Китае до получения в вашей стране. Ознакомьтесь с этапами, согласуйте детали и планируйте следующий шаг.',
  heroContact: 'Обсудить покупку',
  heroSteps: 'Все 8 этапов',
  overviewSteps: 'Этапов от выбора до получения',
  overviewDeposit: 'Аванс в счёт стоимости авто',
  overviewTerms: 'Условия морской доставки',
  processLabel: 'ПРОЦЕСС ПОКУПКИ',
  processTitle: 'Шаг за шагом.',
  processDescription:
    'Данные автомобиля, условия оплаты и обязанности по доставке согласуем до перехода к следующему этапу.',
  stepLabel: 'Шаг {number}',
  steps: {
    choose: {
      title: 'Выберите автомобиль',
      body: 'Сообщите желаемую модель, бюджет и страну назначения. Обсудим доступные варианты и требования к ввозу, которые нужно проверить до покупки.',
      note: 'Опишите свои пожелания или отправьте автомобиль, который рассматриваете.',
    },
    deposit: {
      title: 'Подтвердите заказ',
      body: 'После согласования автомобиля и деталей заказа внесите аванс {deposit} USD для бронирования. Эта сумма засчитывается в стоимость автомобиля.',
      note: 'Условия бронирования, отмены и возврата определяются заказом или договором, согласованным обеими сторонами.',
    },
    inspection: {
      title: 'Проверьте состояние авто',
      body: 'Уточните данные автомобиля и согласованный объём проверки. Изучите доступные фото, видео и сведения о состоянии, прежде чем продолжать покупку.',
      note: 'Объём проверки и порядок действий при выявлении замечаний согласуются для вашего заказа.',
    },
    balance: {
      title: 'Оплатите остаток',
      body: 'После подтверждения состояния автомобиля и итогового счёта оплатите остаток по согласованному заказу или договору. Аванс {deposit} USD вычитается из стоимости автомобиля.',
      note: 'Перед переводом проверьте получателя, сумму, валюту и сроки оплаты.',
    },
    export: {
      title: 'Подготовьте экспорт',
      body: 'После подтверждения покупки мы координируем согласованную подготовку к экспорту из Китая и проверяем необходимые для отправки счета, экспортные и транспортные документы.',
      note: 'Перечень документов зависит от автомобиля, страны назначения и условий поставки.',
    },
    shipping: {
      title: 'Согласуйте международную доставку',
      body: 'Для подходящей морской перевозки можно выбрать CIF или FOB. До отправки согласуем порты, маршрут и распределение расходов на перевозку и страхование.',
      note: 'Для железнодорожных, автомобильных и смешанных маршрутов условия поставки согласуются отдельно. Срок зависит от маршрута и расписания.',
    },
    customs: {
      title: 'Пройдите импортное оформление',
      body: 'В стране назначения вы или ваш брокер оформляете импорт и оплачиваете местные сборы. Мы предоставляем согласованные для заказа документы со стороны экспортёра.',
      note: 'Калькулятор даёт справочную оценку; допуск к ввозу, налоги и окончательные расходы нужно подтвердить отдельно.',
    },
    receive: {
      title: 'Получите свой автомобиль',
      body: 'После таможенного оформления и разрешения на выдачу согласуйте получение автомобиля. При передаче проверьте его состояние, ключи и документы.',
      note: 'До выезда на дороги уточните местные требования к регистрации.',
    },
  },
  termsEyebrow: 'ВЫБЕРИТЕ УСЛОВИЯ ДОСТАВКИ',
  termsTitle: 'CIF или FOB — на ваш выбор.',
  termsDescription:
    'Для подходящей морской перевозки укажите в договоре конкретные порты и Incoterms® 2020. Для автомобильных, железнодорожных и смешанных маршрутов условия подбираются отдельно.',
  cifTitle: 'CIF · Стоимость, страхование и фрахт',
  cifBody:
    'Хотите поручить нам морскую перевозку? При CIF продавец организует фрахт и страхование груза до указанного порта назначения.',
  cifPoints: {
    freight: 'Продавец организует и оплачивает согласованный морской фрахт.',
    insurance: 'Продавец оформляет страхование; покрытие, лимиты и исключения уточняются в заказе.',
    customs:
      'Покупатель оформляет импорт и платит пошлины; расходы в порту назначения уточняются отдельно.',
  },
  fobTitle: 'FOB · Свободно на борту',
  fobBody:
    'У вас уже есть перевозчик? При FOB продавец передаёт автомобиль на борту судна, назначенного покупателем, в указанном порту отгрузки.',
  fobPoints: {
    freight: 'Покупатель организует и оплачивает основную морскую перевозку.',
    insurance:
      'Страхование продавцом по умолчанию не включено; необходимое покрытие организует покупатель.',
    customs: 'Продавец оформляет экспорт, покупатель — импорт и уплату пошлин.',
  },
  riskNote:
    'При CIF и FOB риск обычно переходит к покупателю после погрузки автомобиля на судно в порту отгрузки. Оплата фрахта до порта назначения по CIF не переносит этот момент на прибытие. Применимые условия уточняйте в договоре.',
  faqEyebrow: 'ПЕРЕД ПОКУПКОЙ',
  faqTitle: 'Что ещё стоит знать.',
  faqDescription: 'Важные детали для планирования покупки.',
  faq: {
    destinations: {
      question: 'По каким странам можно обратиться?',
      answer:
        'Можно обсудить Россию, Казахстан, Узбекистан, Грузию, Армению, Кыргызстан и Албанию. Для этих и других направлений маршрут и требования к ввозу конкретного автомобиля подтверждаем до оформления заказа.',
    },
    deposit: {
      question: 'Как учитывается аванс?',
      answer:
        'Он засчитывается в стоимость автомобиля и не является дополнительной платой за услуги. Срок бронирования, сроки оплаты, условия отмены и возврата определяются согласованным обеими сторонами заказом или договором.',
    },
    customs: {
      question: 'Кто отвечает за таможню и местные расходы?',
      answer:
        'Импортное оформление выполняете вы или назначенный вами брокер. Пошлины, портовые сборы, регистрация и местная доставка уточняются отдельно. Наш калькулятор даёт справочную оценку, а не окончательный счёт таможни или полную стоимость с доставкой и оформлением.',
    },
    insurance: {
      question: 'Включена ли страховка перевозки?',
      answer:
        'При морской поставке CIF продавец оформляет страхование груза на согласованных условиях; до отправки уточните покрытие и исключения полиса. При FOB страхование продавцом по умолчанию не включено. Для других маршрутов его согласуют отдельно.',
    },
  },
  ctaEyebrow: 'НАЧНИТЕ С ОБСУЖДЕНИЯ',
  ctaTitle: 'Какой автомобиль вы ищете?',
  ctaDescription:
    'Напишите HD Auto Export желаемую модель, бюджет и страну назначения. Обсудим следующие шаги и подходящие условия доставки.',
  ctaContact: 'Связаться с HD Auto Export',
  ctaCalculator: 'Оценить расходы на импорт',
};

const messages = { zh, en, ru };

export function getBuyingGuideMessages(locale: 'zh' | 'en' | 'ru') {
  return { BuyingGuide: messages[locale] };
}
