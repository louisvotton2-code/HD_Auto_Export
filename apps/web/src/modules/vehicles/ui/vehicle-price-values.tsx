import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { Locale } from '@/i18n/routing';
import { formatPublicVehiclePrice, formatPublicVehicleUsdApproximation } from '../public-presentation';
import styles from './vehicle-price-values.module.css';

const missingUsd = { zh: '暂无美元参考价', en: 'USD estimate unavailable', ru: 'Оценка в USD недоступна' };

export function VehiclePriceValues({ vehicle, locale }: { vehicle: PublicVehicleSummary; locale: Locale }) {
  const approximation = formatPublicVehicleUsdApproximation(vehicle, locale);
  return <>
    <VehiclePriceAmounts original={formatPublicVehiclePrice(vehicle, locale)} approximation={approximation} />
    {!approximation && vehicle.price.money?.currency === 'CNY' &&
      <small className={styles.approximation} data-vehicle-usd-unavailable>{missingUsd[locale]}</small>}
  </>;
}

export function VehiclePriceAmounts({ original, approximation }: {
  original: string;
  approximation: string | null;
}) {
  return (
    <>
      <strong data-vehicle-original-price>{original}</strong>
      {approximation && <small className={styles.approximation} data-vehicle-usd-approx>{approximation}</small>}
    </>
  );
}
