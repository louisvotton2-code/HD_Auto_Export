'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { getPathname, Link } from '@/i18n/navigation';
import { isPublicVehicleDetailPath } from '@/shared/lib/public-vehicle-detail-path';

function NavigationHint() {
  const { pending } = useLinkStatus();
  const t = useTranslations('Nav');
  return (
    <>
      <span className="navigation-hint" data-pending={pending} aria-hidden="true" />
      <span className="sr-only" role="status">
        {pending ? t('loading') : ''}
      </span>
    </>
  );
}

/** Retains Next's navigation/prefetch and native links; pending feedback never delays navigation. */
export function NavigationLink({
  children,
  locale,
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  prefetch,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const currentLocale = useLocale();
  const router = useRouter();
  const localizedHref = locale ? getPathname({ href, locale }) : null;
  const browse = /^(?:\/(?:zh|en|ru))?\/(?:cars\/?(?:\?|#|$)|$)/.test(localizedHref ?? href);
  // next-intl intentionally disables viewport prefetch for locale links. Warm only on intent;
  // this site serves static locale URLs without locale detection or a redirecting proxy.
  const prefetchLocale = () => {
    if (!browse && localizedHref && locale !== currentLocale) router.prefetch(localizedHref);
  };
  // A detail language switch must read a new document even when a route was previously visited.
  if (localizedHref && isPublicVehicleDetailPath(localizedHref)) {
    return <a {...props} href={localizedHref} onMouseEnter={onMouseEnter} onFocus={onFocus} onTouchStart={onTouchStart}>
      {children}
    </a>;
  }
  return (
    <Link
      {...props}
      href={href}
      locale={locale}
      prefetch={browse ? false : prefetch}
      data-navigation-link=""
      onMouseEnter={(event) => {
        prefetchLocale();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetchLocale();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        prefetchLocale();
        onTouchStart?.(event);
      }}
    >
      {children}
      <NavigationHint />
    </Link>
  );
}
