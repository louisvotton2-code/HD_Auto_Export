import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import { getCalculatorMessages } from '@/modules/calculator/application/calculator-messages';
import { getBuyingGuideMessages } from '@/modules/buying-guide/messages';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    timeZone: 'Asia/Shanghai',
    messages: {
      ...(await import(`../messages/${locale}.json`)).default,
      ...getCalculatorMessages(locale),
      ...getBuyingGuideMessages(locale),
    },
  };
});
