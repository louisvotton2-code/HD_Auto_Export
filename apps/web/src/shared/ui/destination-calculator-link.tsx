'use client';

import type { ComponentProps } from 'react';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { destinationCalculatorPath } from '@/shared/lib/destination-country';
import { useDestinationCountry } from './use-destination-country';

export function DestinationCalculatorLink(
  props: Omit<ComponentProps<typeof Link>, 'href' | 'locale' | 'prefetch'>,
) {
  const pathname = usePathname();
  const { country, ready } = useDestinationCountry(undefined, pathname);

  return <Link {...props} href={destinationCalculatorPath(country)} prefetch={ready} />;
}
