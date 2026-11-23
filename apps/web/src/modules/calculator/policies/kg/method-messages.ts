import { unifiedMethods } from '../eaeu-method-messages';

export const kgMethodMessages = {
  zh: {
    ...unifiedMethods.zh,
    officialCompanyMiddle: '适用的普通汽油车税号在该车龄档取 CIF 货值的 20% 与每 cc 0.44 欧元两者较高值。',
    officialCompanyOld: '适用的普通汽油车税号在超过七年时按每 cc 2.20 欧元计算。',
    officialCompanyVat: '增值税为海关货值及进口关税之和的 12%。本口径下另计的海关作业费不纳入税基。',
    officialCompanyFee: '按海关货值的 0.4% 计算，最低 500 KGS，最高 250,000 KGS。',
  },
  en: {
    ...unifiedMethods.en,
    officialCompanyMiddle: 'For this petrol tariff line and age band, take the higher of 20% of customs value and EUR 0.44 per cc.',
    officialCompanyOld: 'The applicable petrol tariff line uses EUR 2.20 per cc once the vehicle is older than seven years.',
    officialCompanyVat: 'VAT is 12% of customs value plus import duty. The customs-operation charge is assessed separately.',
    officialCompanyFee: 'Apply 0.4% to the customs value, with a KGS 500 minimum and KGS 250,000 maximum.',
  },
  ru: {
    ...unifiedMethods.ru,
    officialCompanyMiddle: 'Для выбранной бензиновой категории берётся большее из 20% таможенной стоимости или 0,44 EUR за см³.',
    officialCompanyOld: 'Для применимой бензиновой категории старше семи лет ставка составляет 2,20 EUR за см³.',
    officialCompanyVat: 'НДС равен 12% от таможенной стоимости и ввозной пошлины. Сбор за таможенные операции рассчитывается отдельно.',
    officialCompanyFee: 'Сбор равен 0,4% таможенной стоимости, минимум 500 и максимум 250 000 KGS.',
  },
} as const;
