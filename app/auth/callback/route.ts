import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/src/lib/supabase/server';
import { getSafeReturnPath } from '@/src/lib/auth/paths';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = getSafeReturnPath(request.nextUrl.searchParams.get('next'));
  const supabase = await createClient();

  if (!supabase) return NextResponse.redirect(new URL('/auth/configuration-required', request.url));
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  const url = new URL('/auth/sign-in', request.url);
  url.searchParams.set('error', 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ');
  return NextResponse.redirect(url);
}
