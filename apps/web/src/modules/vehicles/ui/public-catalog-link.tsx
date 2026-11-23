'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';
import { Icon } from '@/shared/ui/icon';
import { publicVehicleMessages } from '../public-messages';
import styles from './public-vehicles.module.css';

function PendingLabel({ locale }: { locale: Locale }) {
  const { pending } = useLinkStatus();
  return (
    <span className={styles.linkPending} role="status" data-link-pending={pending || undefined}>
      <span aria-hidden="true" className={styles.linkPendingDot}><Icon name="loader" size={16} /></span>
      <span className={styles.srOnly}>{pending ? publicVehicleMessages(locale).loading : ''}</span>
    </span>
  );
}

/** Vehicle links read a fresh document. Browse links keep App Router navigation without prefetch. */
export function PublicCatalogLink({
  locale,
  href,
  scroll,
  children,
  ...props
}: Omit<ComponentProps<'a'>, 'children' | 'href'> & { locale: Locale; href: string; scroll?: boolean; children: ReactNode }) {
  if (isPublicVehicleDetailPath(href)) return <a {...props} href={href}>{children}</a>;
  return (
    <Link {...props} href={href} scroll={scroll ?? true} prefetch={false}>
      {children}
      <PendingLabel locale={locale} />
    </Link>
  );
}
