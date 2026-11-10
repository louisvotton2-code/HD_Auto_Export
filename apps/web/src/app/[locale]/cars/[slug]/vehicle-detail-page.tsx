'use client';

import type { ComponentProps } from 'react';
import { PublicDetailResource } from '@/modules/vehicles';
import { VehicleImportEstimate } from '@/modules/calculator/ui/vehicle-import-estimate';
import type { ExchangeRateSnapshot } from '@/modules/calculator/infrastructure/exchange-rates';

type Props = Omit<ComponentProps<typeof PublicDetailResource>, 'renderBudget'> & {
  initialDate: string;
  initialRates: ExchangeRateSnapshot;
};

/** App composition joins two independent modules without importing UI into the pure tax facade. */
export function VehicleDetailPage({ initialDate, initialRates, ...props }: Props) {
  return (
    <PublicDetailResource
      {...props}
      renderBudget={(vehicle, current) => (
        <VehicleImportEstimate
          key={JSON.stringify([vehicle.id, vehicle.facts, vehicle.price])}
          vehicle={vehicle}
          locale={props.locale}
          initialDate={initialDate}
          initialRates={initialRates}
          disabled={!current}
        />
      )}
    />
  );
}
