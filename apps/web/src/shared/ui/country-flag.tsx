import al from '../../../public/flags/al.svg?site-asset';
import am from '../../../public/flags/am.svg?site-asset';
import cn from '../../../public/flags/cn.svg?site-asset';
import gb from '../../../public/flags/gb.svg?site-asset';
import ge from '../../../public/flags/ge.svg?site-asset';
import kg from '../../../public/flags/kg.svg?site-asset';
import kz from '../../../public/flags/kz.svg?site-asset';
import ru from '../../../public/flags/ru.svg?site-asset';
import uz from '../../../public/flags/uz.svg?site-asset';
import { siteAssetUrl } from '@/shared/config/site-asset';
import { isDestinationCountry, type DestinationCountryCode } from '@/shared/lib/destination-country';
import styles from './country-flag.module.css';

export type FlagCountryCode = DestinationCountryCode | 'CN' | 'GB';
const flags: Record<FlagCountryCode, string> = {
  AL: al, AM: am, CN: cn, GB: gb, GE: ge, KG: kg, KZ: kz, RU: ru, UZ: uz,
};

/** Local SVG set imported from flagcdn.com. Adjacent text supplies the accessible label. */
export function CountryFlag({ countryCode, className = '' }: {
  countryCode: FlagCountryCode | undefined;
  className?: string;
}) {
  if (countryCode !== 'CN' && countryCode !== 'GB' && !isDestinationCountry(countryCode)) return null;
  return <img className={`${styles.flag} ${className}`} src={siteAssetUrl(flags[countryCode])}
    alt="" aria-hidden="true" width={24} height={16} />;
}
