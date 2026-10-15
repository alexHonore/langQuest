import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Next.js proxy (formerly middleware): refreshes the Supabase session cookie on every request
 * and performs the optimistic staff gate — anonymous visitors go to /login, signed-in users
 * without a `user_roles` row are signed out and told why. Layouts and route handlers run the
 * authoritative check again (`requireStaff` / `requireSection`), and the API + RLS enforce
 * every write regardless of what this proxy decided.
 */
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/locale'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Unconfigured: let /login render its honest setup state; block everything else.
    return isPublic ? response : NextResponse.redirect(new URL('/login?reason=setup', request.url));
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the token with Supabase (never trust the cookie payload alone).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApi = pathname.startsWith('/api/');
  if (!user) {
    if (isPublic) return response;
    if (isApi) return NextResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Sign in required' } }, { status: 401 });
    const login = new URL('/login', request.url);
    login.searchParams.set('reason', 'signin');
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  if (isPublic && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  if (isPublic) return response;

  const { data: roles } = await supabase.from('user_roles').select('role, expires_at').eq('user_id', user.id);
  const now = Date.now();
  const active = (roles ?? []).filter((r) => !r.expires_at || Date.parse(r.expires_at) > now);
  if (active.length === 0) {
    if (isApi) return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'No staff role' } }, { status: 403 });
    await supabase.auth.signOut();
    const login = new URL('/login', request.url);
    login.searchParams.set('reason', 'norole');
    const redirect = NextResponse.redirect(login);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
