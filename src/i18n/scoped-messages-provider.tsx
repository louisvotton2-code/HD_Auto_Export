'use client';

import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  type AbstractIntlMessages,
} from 'next-intl';
import type { ReactNode } from 'react';

/** Merge leaf-only namespaces without re-serializing cached parent messages on every route. */
export function ScopedMessagesProvider({
  messages,
  children,
}: {
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  const shared = useMessages();
  const locale = useLocale();
  return (
    <NextIntlClientProvider locale={locale} messages={{ ...shared, ...messages }}>
      {children}
    </NextIntlClientProvider>
  );
}
