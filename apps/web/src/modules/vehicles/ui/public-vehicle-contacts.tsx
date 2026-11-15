'use client';
import { publicVehicleReference } from '@/shared/lib/public-vehicle-reference';
import type { PublicVehicleSummary } from '@/shared/lib/public-vehicle-summary';
import { usePublicFreshness } from '../application/use-public-resource';
import type { Locale } from '@/i18n/routing';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { SocialIcon } from '@/shared/ui/social-icon';
import { publicVehicleMessages } from '../public-messages';
import { externalDetailCopy } from '../external-detail-copy';
import { buildVehicleInspectionContactLinks } from '../inspection-contact';
import styles from './public-vehicle-contacts.module.css';

export function PublicVehicleContacts({
  vehicle,
  locale,
  variant = 'card',
  purpose = 'vehicle',
}: {
  vehicle: PublicVehicleSummary;
  locale: Locale;
  variant?: 'card' | 'detail';
  purpose?: 'vehicle' | 'inspection';
}) {
  const t = publicVehicleMessages(locale);
  const trusted = usePublicFreshness() === 'fresh';
  const inspection = purpose === 'inspection';
  const links = inspection
    ? buildVehicleInspectionContactLinks(vehicle, locale)
    : buildPublicVehicleContactLinks(vehicle, locale);
  const telegramLabel = inspection
    ? `${externalDetailCopy[locale].requestReport} — Telegram`
    : vehicle.availability === 'sold' ? `${t.similar} — Telegram` : t.contactTelegram;
  const whatsappLabel = inspection
    ? `${externalDetailCopy[locale].requestReport} — WhatsApp`
    : vehicle.availability === 'sold' ? `${t.similar} — WhatsApp` : t.contactWhatsapp;
  return (
    <div
      className={`${styles.contactActions} ${variant === 'detail' ? styles.detailContacts : styles.cardContacts}`}
      data-vehicle-contacts={inspection ? undefined : vehicle.id}
      data-vehicle-report-contacts={inspection ? vehicle.id : undefined}
    >
      <a
        className={`${styles.contactAction} ${styles.telegram}`}
        href={trusted ? links.telegram : undefined}
        aria-disabled={!trusted || undefined}
        tabIndex={trusted ? undefined : -1}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${telegramLabel} — ${publicVehicleReference(vehicle).code}`}
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
        aria-label={`${whatsappLabel} — ${publicVehicleReference(vehicle).code}`}
      >
        <SocialIcon platform="whatsapp" size={19} />
        <span className={variant === 'card' ? styles.srOnly : undefined}>WhatsApp</span>
      </a>
    </div>
  );
}
