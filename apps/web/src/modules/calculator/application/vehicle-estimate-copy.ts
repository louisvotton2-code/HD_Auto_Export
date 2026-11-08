/** Details-only vocabulary; calculation labels and fee methods use the existing messages. */
export const vehicleEstimateCopy = {
  zh: {
    completeTool: '打开完整计算器',
    facts: '根据车辆资料预填，缺失信息可补充。',
    referencePrice: '已带入车辆参考价，可按实际成交价修改。',
    convertedPower: '初始 hp 由车辆 kW 换算（1 kW ≈ 1.35962 hp）。',
    waiting: '车辆资料暂不可用，请恢复后再测算。',
    seedHint: '填写有效参数后，完整计算器将保留当前设置。',
  },
  en: {
    completeTool: 'Open full calculator',
    facts: 'Known vehicle details are filled in. Add any missing information.',
    referencePrice: 'The vehicle reference price is filled in; adjust it to the agreed purchase price.',
    convertedPower: 'Initial hp is converted from vehicle kW (1 kW ≈ 1.35962 hp).',
    waiting: 'Vehicle details are unavailable. Restore them before calculating.',
    seedHint: 'With valid inputs, the full calculator retains these settings.',
  },
  ru: {
    completeTool: 'Открыть полный калькулятор',
    facts: 'Известные данные автомобиля заполнены. Дополните недостающие сведения.',
    referencePrice: 'Указана справочная цена автомобиля. При необходимости введите согласованную цену покупки.',
    convertedPower: 'Исходные л. с. рассчитаны из кВт (1 кВт ≈ 1,35962 л. с.).',
    waiting: 'Данные автомобиля недоступны. Восстановите их перед расчётом.',
    seedHint: 'При корректных данных полный калькулятор сохранит эти настройки.',
  },
} as const;
