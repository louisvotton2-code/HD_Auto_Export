import { isDestinationCountry, type DestinationCountryCode } from '@/shared/lib/destination-country';
import styles from './country-flag.module.css';

/** Local SVG set imported from flagcdn.com. Country names supply the accessible label. */
export function CountryFlag({ countryCode, className = '' }: {
  countryCode: DestinationCountryCode | undefined;
  className?: string;
}) {
  if (!isDestinationCountry(countryCode)) return null;
  return <img className={`${styles.flag} ${className}`} src={`/flags/${countryCode.toLowerCase()}.svg`}
    alt="" aria-hidden="true" width={24} height={16} />;
}
