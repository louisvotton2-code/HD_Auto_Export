import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { getCalculatorCommonMessages } from '@/i18n/client-messages';

/** Shared calculator vocabulary stays cached across destination changes. */
export default async function CalculatorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = getCalculatorCommonMessages(await getMessages());
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
