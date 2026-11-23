import { eaeuMethodMessages } from '../eaeu-method-messages';

export const ruMethodMessages = {
  zh: {
    ...eaeuMethodMessages.zh,
    dutyElectric:
      '纯电车型按折合车价 {value} RUB 的 {percentage}% 计征关税，结果四舍五入至整 RUB。',
    customsFee:
      '折合车价 {value} RUB 落入超过 {lower}、不超过 {upper} RUB 的手续费档，收取固定 {fee} RUB，而非按比例计算。',
    customsFeeTop:
      '折合车价 {value} RUB 超过最高分档门槛 {lower} RUB，收取固定手续费 {fee} RUB。',
    electricExcise:
      "按认证的 30 分钟功率 {hp} hp 选取每马力 {rate} RUB 的消费税档，功率乘该单价为应计额。",
    electricVat:
      "车价 {value} RUB、关税 {duty} RUB 和消费税 {excise} RUB 相加，再按 22% 计进口增值税。",
    recyclingConcession:
      "按 {hp} hp、车龄及个人自用优惠条件，基数 {base} RUB 乘优惠系数 {coefficient}。",
    recyclingTable:
      "按车型、车龄及 {hp} hp 选取适用系数 {coefficient}，乘基数 {base} RUB。",
  },
  en: {
    ...eaeuMethodMessages.en,
    dutyElectric:
      'For a battery electric vehicle, duty is {percentage}% of the converted vehicle price of {value} RUB, rounded to whole RUB.',
    customsFee:
      'The converted vehicle price of {value} RUB falls above {lower} and up to {upper} RUB, so the fixed clearance fee is {fee} RUB rather than a percentage.',
    customsFeeTop:
      'The converted vehicle price of {value} RUB exceeds the highest threshold of {lower} RUB, so the fixed clearance fee is {fee} RUB.',
    electricExcise:
      "Certified 30-minute power of {hp} hp selects an excise rate of {rate} RUB per hp. Multiply that rate by the rated power.",
    electricVat:
      "Add the vehicle value of {value} RUB, duty of {duty} RUB and excise of {excise} RUB. Import VAT is 22% of that sum.",
    recyclingConcession:
      "At {hp} hp, the vehicle age and personal-use concession give coefficient {coefficient}, applied to the base of {base} RUB.",
    recyclingTable:
      "For this type, age and power of {hp} hp, multiply the applicable coefficient {coefficient} by the base of {base} RUB.",
  },
  ru: {
    ...eaeuMethodMessages.ru,
    dutyElectric:
      'Для электромобиля пошлина составляет {percentage}% от стоимости автомобиля {value} RUB с округлением до целых RUB.',
    customsFee:
      'Стоимость автомобиля {value} RUB попадает в диапазон свыше {lower} до {upper} RUB включительно: фиксированный сбор составляет {fee} RUB, а не процент от стоимости.',
    customsFeeTop:
      'Стоимость автомобиля {value} RUB превышает верхний порог {lower} RUB: применяется фиксированный сбор {fee} RUB.',
    electricExcise:
      "По максимальной 30-минутной мощности {hp} л. с. выбирается ставка акциза {rate} RUB за л. с., которая умножается на мощность.",
    electricVat:
      "Стоимость {value} RUB, пошлина {duty} RUB и акциз {excise} RUB образуют базу ввозного НДС по ставке 22%.",
    recyclingConcession:
      "При {hp} л. с. с учётом возраста и льготы для личного ввоза база {base} RUB умножается на коэффициент {coefficient}.",
    recyclingTable:
      "Для типа машины, возраста и мощности {hp} л. с. коэффициент {coefficient} умножается на базу {base} RUB.",
  },
} as const;
