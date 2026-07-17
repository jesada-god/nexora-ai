export const PROTECTED_PATHS = ['/portfolio', '/watchlist', '/alerts', '/settings', '/profile'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function getSafeReturnPath(value: FormDataEntryValue | string | null | undefined): string {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(value)
  ) return '/';

  const parsed = new URL(value, 'https://nexora.local');
  if (parsed.origin !== 'https://nexora.local') return '/';
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
