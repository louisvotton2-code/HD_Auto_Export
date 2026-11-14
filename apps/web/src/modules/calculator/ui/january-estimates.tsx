import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import type { estimateJanuaryManufacture } from '../application/january-estimates';
import { convertImportAmountToUsd } from '../application/display-currency';
import { formatCalculatorMoney } from '../application/fee-presentation';
import type { ExchangeRateSnapshot } from '../infrastructure/exchange-rates';
import styles from './january-estimates.module.css';

export const januaryEstimateCopy = {
  zh: { title: '按每年 1 月测算', note: '生产月份未知时，按以下月份分别估算。填写实际生产月份后可查看该月份的费用明细。' },
  en: { title: 'January estimates by year', note: 'These estimates assume the vehicle was made in the month shown. Enter the actual manufacture month to see an itemized estimate.' },
  ru: { title: 'Расчёт для января каждого года', note: 'Каждый вариант предполагает выпуск в указанном месяце. Для подробного расчёта укажите фактический месяц выпуска.' },
} satisfies Record<Locale, { title: string; note: string }>;

export function JanuaryEstimates({ scenarios, locale, rates }: {
  scenarios: ReturnType<typeof estimateJanuaryManufacture>;
  locale: Locale;
  rates: ExchangeRateSnapshot;
}) {
  const t = useTranslations('Calculator');
  const reasons = useTranslations('Reasons');
  const assumptionText = useTranslations('Assumptions');
  const assumptions = [...new Set(scenarios.flatMap(({ result }) => result.assumptions))];
  const copy = januaryEstimateCopy[locale];
  return <section className={styles.estimates} data-testid="january-estimates">
    <h3>{copy.title}</h3>
    <p>{copy.note}</p>
    <dl>
      {scenarios.map(({ manufactureDate, input, result }) => {
        const { total, currency, status } = result;
        const usd = total === null ? null : convertImportAmountToUsd(total, input, rates);
        const failure = result.reason === 'rule_date_outside_reference' ? reasons('year_pending')
          : status === 'invalid' ? t('invalidTitle')
            : status === 'incomplete' ? t('missingTitle')
              : status === 'needs_review' ? t('reviewTitle') : t('unavailable');
        return <div key={manufactureDate} data-january-month={manufactureDate} data-status={status}>
          <dt><time dateTime={manufactureDate}>{manufactureDate}</time></dt>
          <dd>{total === null ? <span>{failure}</span> : <>
            <strong>{formatCalculatorMoney(total, locale)} {currency}</strong>
            {usd !== null && <small>≈ {formatCalculatorMoney(usd, locale)} USD</small>}
          </>}</dd>
        </div>;
      })}
    </dl>
    {assumptions.length > 0 && <ul className={styles.assumptions}>
      {assumptions.map(key => <li key={key}>{assumptionText(key)}</li>)}
    </ul>}
    <p>{t('notLanded')}</p>
    <p>{t('simpleReferenceNotice')}</p>
  </section>;
}
