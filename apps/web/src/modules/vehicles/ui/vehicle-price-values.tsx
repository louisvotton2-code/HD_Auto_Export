import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import type { Locale } from '@/i18n/routing';
import { formatPublicVehiclePrice, formatPublicVehicleUsdApproximation } from '../public-presentation';
import styles from './vehicle-price-values.module.css';

export function VehiclePriceValues({ vehicle, locale }: { vehicle: PublicVehicleSummary; locale: Locale }) {
  return <VehiclePriceAmounts
    original={formatPublicVehiclePrice(vehicle, locale)}
    approximation={formatPublicVehicleUsdApproximation(vehicle, locale)}
  />;
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
