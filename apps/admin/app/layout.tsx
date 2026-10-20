import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { currentLocale } from '@/src/lib/i18n/server';
import { I18nProvider } from '@/src/lib/i18n/client';
import { ToastProvider } from '@/src/components/toast';
import { SCHEME_BOOT_SCRIPT, themeCss } from '@/src/lib/visual/theme';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'LangQuest Studio', template: '%s · LangQuest Studio' },
  description: 'Private administrator CMS for LangQuest.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Token-driven palette (light default, dark behind data-theme) and the no-flash scheme boot. */}
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: SCHEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
