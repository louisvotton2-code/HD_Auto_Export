'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import styles from './public-vehicles.module.css';

function PendingLabel({ locale }: { locale: Locale }) {
  const { pending } = useLinkStatus();
  return (
    <span className={styles.linkPending} role="status">
      {pending ? publicVehicleMessages(locale).loading : ''}
    </span>
  );
}

/** Localized URLs already come from the public contract. Avoid stale prefetched inventory. */
export function PublicCatalogLink({
  locale,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'children'> & { locale: Locale; children: ReactNode }) {
  return (
    <Link {...props} prefetch={false}>
      {children}
      <PendingLabel locale={locale} />
    </Link>
  );
}
