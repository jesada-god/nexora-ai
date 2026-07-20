import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, clientEnv } from '@/src/config/env/client';
import { isProtectedPath } from '@/src/lib/auth/paths';
import type { Database } from '@/src/types/database';

function supabaseConnectSources(): string[] {
  if (!clientEnv.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    const url = new URL(clientEnv.NEXT_PUBLIC_SUPABASE_URL);
    return [url.origin, `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`];
  } catch {
    return [];
  }
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  const scriptSources = [`'self'`, `'unsafe-inline'`, ...(process.env.NODE_ENV === 'development' ? [`'unsafe-eval'`] : [])];
  const policy = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `script-src ${scriptSources.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://picsum.photos`,
    `font-src 'self' data:`,
    `connect-src ${[`'self'`, ...supabaseConnectSources()].join(' ')}`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
  ].join('; ');
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedRoute = isProtectedPath(pathname);

  if (!isSupabaseConfigured) {
    if (!protectedRoute) return withSecurityHeaders(NextResponse.next());
    const url = request.nextUrl.clone();
    url.pathname = '/auth/configuration-required';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL as string,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const hadSessionCookie = request.cookies.getAll().some(({ name }) => name.startsWith('sb-'));
  const { data: { user } } = await supabase.auth.getUser();

  if (protectedRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    if (hadSessionCookie) url.searchParams.set('reason', 'session_expired');
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach(({ name, value }) => redirectResponse.cookies.set(name, value));
    return withSecurityHeaders(redirectResponse);
  }

  return withSecurityHeaders(response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icon.svg|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
