'use client';
import type { PublicVehicle } from '@hd/contracts/public';
import { usePublicFreshness } from '../application/use-public-resource';
import type { Locale } from '@/i18n/routing';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { SocialIcon } from '@/shared/ui/social-icon';
import { publicVehicleMessages } from '../public-messages';
import styles from './vehicles.module.css';

export function PublicVehicleContacts({
  vehicle,
  locale,
  variant = 'card',
}: {
  vehicle: PublicVehicle;
  locale: Locale;
  variant?: 'card' | 'detail';
}) {
  const t = publicVehicleMessages(locale);
  const trusted = usePublicFreshness() === 'fresh';
  const links = buildPublicVehicleContactLinks(vehicle, locale);
  return (
    <div
      className={`${styles.contactActions} ${variant === 'detail' ? styles.detailContacts : styles.cardContacts}`}
      data-vehicle-contacts={vehicle.id}
    >
      <a
        className={`${styles.contactAction} ${styles.telegram}`}
        href={trusted ? links.telegram : undefined}
        aria-disabled={!trusted || undefined}
        tabIndex={trusted ? undefined : -1}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${vehicle.availability === 'sold' ? `${t.similar} — Telegram` : t.contactTelegram} — ${vehicle.stockCode}`}
      >
        <SocialIcon platform="telegram" size={19} />
        <span className={variant === 'card' ? styles.srOnly : undefined}>Telegram</span>
      </a>
      <a
        className={`${styles.contactAction} ${styles.whatsapp}`}
        href={trusted ? links.whatsapp : undefined}
        aria-disabled={!trusted || undefined}
        tabIndex={trusted ? undefined : -1}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${vehicle.availability === 'sold' ? `${t.similar} — WhatsApp` : t.contactWhatsapp} — ${vehicle.stockCode}`}
      >
        <SocialIcon platform="whatsapp" size={19} />
        <span className={variant === 'card' ? styles.srOnly : undefined}>WhatsApp</span>
      </a>
    </div>
  );
}
