import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ADMIN_LOCALES, LOCALE_COOKIE } from '@/src/lib/i18n';

const Body = z.object({ locale: z.enum(ADMIN_LOCALES) });

/** POST /api/locale — persists the interface language in a cookie (one year). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: { code: 'validation_failed', message: 'locale must be en or fr' } }, { status: 422 });
  const res = NextResponse.json({ ok: true, data: { locale: parsed.data.locale } });
  res.cookies.set(LOCALE_COOKIE, parsed.data.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
