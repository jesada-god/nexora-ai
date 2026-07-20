'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/src/store/useStore';

const REFRESH_AFTER_MS = 2 * 60_000;

export function AppRuntime() {
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useStore((state) => state.reducedMotion);
  const inactiveAt = useRef<number | null>(null);

  useEffect(() => {
    void useStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => { void navigator.serviceWorker.register('/sw.js', { scope: '/' }); };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        inactiveAt.current = Date.now();
        window.dispatchEvent(new Event('app-inactive'));
        return;
      }
      const awayFor = inactiveAt.current == null ? 0 : Date.now() - inactiveAt.current;
      inactiveAt.current = null;
      window.dispatchEvent(new CustomEvent('app-active', { detail: { awayFor } }));
      if (navigator.onLine && awayFor >= REFRESH_AFTER_MS && !pathname.startsWith('/auth/')) router.refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [pathname, router]);

  return null;
}
