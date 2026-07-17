import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, clientEnv } from '@/src/config/env/client';
import { isProtectedPath } from '@/src/lib/auth/paths';
import type { Database } from '@/src/types/database';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedRoute = isProtectedPath(pathname);

  if (!isSupabaseConfigured) {
    if (!protectedRoute) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = '/auth/configuration-required';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
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
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icon.svg|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
