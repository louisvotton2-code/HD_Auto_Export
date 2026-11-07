import type { Locale } from '@/i18n/routing';
import { buildVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { SocialIcon } from '@/shared/ui/social-icon';
import type { Vehicle } from '../types';
import { vehicleMessages } from '../messages';
import styles from './vehicles.module.css';

/** Contact links remain separate from the card's detail link; neither sends a message. */
export function VehicleContactActions({
  vehicle,
  locale,
  variant = 'card',
}: {
  vehicle: Vehicle;
  locale: Locale;
  variant?: 'card' | 'detail';
}) {
  const t = vehicleMessages(locale);
  const links = buildVehicleContactLinks(
    {
      id: vehicle.slug,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      priceUsd: vehicle.priceUsd,
      mileageKm: vehicle.mileageKm,
      fuel: vehicle.fuel,
      body: vehicle.body,
      detailPath: `/${locale}/cars/${vehicle.slug}/`,
    },
    locale,
  );
  const name = `${vehicle.make} ${vehicle.model}`;

  return (
    <div
      className={`${styles.contactActions} ${variant === 'detail' ? styles.detailContacts : styles.cardContacts}`}
      data-vehicle-contacts={vehicle.slug}
    >
      <a
        className={`${styles.contactAction} ${styles.telegram}`}
        href={links.telegram}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${t.contactTelegram} — ${name}`}
      >
        <SocialIcon platform="telegram" size={19} />
        <span className={variant === 'card' ? styles.srOnly : undefined}>Telegram</span>
      </a>
      <a
        className={`${styles.contactAction} ${styles.whatsapp}`}
        href={links.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${t.contactWhatsapp} — ${name}`}
      >
        <SocialIcon platform="whatsapp" size={19} />
        <span className={variant === 'card' ? styles.srOnly : undefined}>WhatsApp</span>
      </a>
    </div>
  );
}
