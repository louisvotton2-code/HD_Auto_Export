import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { formatPublicVehiclePrice, formatPublicVehicleUsdApproximation } from '../public-presentation';
import styles from './vehicle-price-values.module.css';

export function VehiclePriceValues({ vehicle, locale }: { vehicle: PublicVehicle; locale: Locale }) {
  const converted = formatPublicVehicleUsdApproximation(vehicle, locale);
  return (
    <>
      <strong data-vehicle-original-price>{formatPublicVehiclePrice(vehicle, locale)}</strong>
      {converted && <small className={styles.approximation} data-vehicle-usd-approx>{converted}</small>}
    </>
  );
}
