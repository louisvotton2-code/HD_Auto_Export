import type { PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { buildPublicVehicleContactLinks } from '@/shared/lib/vehicle-contact';
import { externalDetailCopy } from './external-detail-copy';

/** Preserve the shared vehicle identity and contact accounts when requesting its report. */
export function buildVehicleInspectionContactLinks(vehicle: PublicVehicle, locale: Locale) {
  const links = buildPublicVehicleContactLinks(vehicle, locale);
  const message = `${externalDetailCopy[locale].requestReportMessage}\n\n${links.message}`;
  const telegram = new URL(links.telegram);
  const whatsapp = new URL(links.whatsapp);
  telegram.searchParams.set('text', message);
  whatsapp.searchParams.set('text', message);
  return { telegram: telegram.href, whatsapp: whatsapp.href, message };
}
