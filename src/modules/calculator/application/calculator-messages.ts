import { ruMethodMessages } from '../policies/ru/method-messages';
import { kzMethodMessages } from '../policies/kz/method-messages';
import { uzMethodMessages } from '../policies/uz/method-messages';
import { geMethodMessages } from '../policies/ge/method-messages';
import { amMethodMessages } from '../policies/am/method-messages';
import { kgMethodMessages } from '../policies/kg/method-messages';
import { alMethodMessages } from '../policies/al/method-messages';
import { feeDisplayMessages } from './fee-display-messages';
import { stampMessages } from './stamp-messages';
import { copyQuoteMessages } from './copy-messages';

export function getCalculatorMessages(locale: 'zh' | 'en' | 'ru') {
  return {
    FeeMethods: {
      RU: ruMethodMessages[locale],
      KZ: kzMethodMessages[locale],
      UZ: uzMethodMessages[locale],
      GE: geMethodMessages[locale],
      AM: amMethodMessages[locale],
      KG: kgMethodMessages[locale],
      AL: alMethodMessages[locale],
    },
    FeeDisplay: feeDisplayMessages[locale],
    ResultStamp: stampMessages[locale],
    CopyQuote: copyQuoteMessages[locale],
  };
}
