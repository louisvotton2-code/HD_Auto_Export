'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { publicVehicleMessages } from '../public-messages';
import styles from './public-vehicles.module.css';

function PendingLabel({ locale }: { locale: Locale }) {
  const { pending } = useLinkStatus();
  return (
    <span className={styles.linkPending} role="status" data-link-pending={pending || undefined}>
      <span aria-hidden="true" className={styles.linkPendingDot} />
      <span className={styles.srOnly}>{pending ? publicVehicleMessages(locale).loading : ''}</span>
    </span>
  );
}

/** Inventory prefetch has a zero background budget; intent navigation gets immediate inline feedback. */
export function PublicCatalogLink({
  locale,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'children'> & { locale: Locale; children: ReactNode }) {
  return (
    <Link {...props} scroll={props.scroll ?? true} prefetch={false}>
      {children}
      <PendingLabel locale={locale} />
    </Link>
  );
}
