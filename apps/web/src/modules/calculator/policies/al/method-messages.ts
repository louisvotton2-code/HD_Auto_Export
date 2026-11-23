export const alMethodMessages = {
  zh: {
    vatDeclared: '按海关接受的成交价值测算。车价与已填运保折合 {taxableBase} ALL，税率为 20%。需要其他估值方式时由海关核定。',
    vatNewElectric: '出厂零公里、从未登记的纯电乘用车在此资格下免进口增值税。',
    registration: '普通进口二手车登记包含实车核验证书 2,000、行驶证 2,500 和两块号牌 4,000 ALL。技术检验及其他税费另核。',
  },
  en: {
    vatDeclared: 'Uses the customs-accepted transaction value. Vehicle price and the supplied freight and insurance total {taxableBase} ALL at 20%. Customs may require an alternative valuation.',
    vatNewElectric: 'An eligible factory-new, zero-kilometre electric passenger car that has never been registered is exempt from import VAT.',
    registration: 'Ordinary used import registration includes the physical check certificate (2,000), road permit (2,500) and two plates (4,000 ALL). Technical inspection and other charges are assessed separately.',
  },
  ru: {
    vatDeclared: 'Расчёт по цене сделки, принятой таможней. Цена и указанные перевозка со страховкой составляют {taxableBase} ALL по ставке 20%. Таможня может применить иной метод оценки.',
    vatNewElectric: 'Новый легковой электромобиль с нулевым пробегом без предыдущей регистрации освобождён от импортного НДС при соблюдении условий.',
    registration: 'Стандартная регистрация подержанного импортного авто включает проверку (2 000), разрешение (2 500) и два номера (4 000 ALL). Техосмотр и прочие платежи определяются отдельно.',
  },
} as const;
