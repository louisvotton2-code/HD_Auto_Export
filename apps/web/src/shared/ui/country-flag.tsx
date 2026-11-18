import { isDestinationCountry, type DestinationCountryCode } from '@/shared/lib/destination-country';
import styles from './country-flag.module.css';

export type FlagCountryCode = DestinationCountryCode | 'CN' | 'GB';

/** Local SVG set imported from flagcdn.com. Adjacent text supplies the accessible label. */
export function CountryFlag({ countryCode, className = '' }: {
  countryCode: FlagCountryCode | undefined;
  className?: string;
}) {
  if (countryCode !== 'CN' && countryCode !== 'GB' && !isDestinationCountry(countryCode)) return null;
  return <img className={`${styles.flag} ${className}`} src={`/flags/${countryCode.toLowerCase()}.svg`}
    alt="" aria-hidden="true" width={24} height={16} />;
}
