'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function AlertEvaluationOnOpen() {
  const pathname = usePathname(); const lastRun = useRef(0);
  useEffect(() => {
    if (pathname.startsWith('/auth/')) return;
    const evaluate = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || Date.now() - lastRun.current < 2 * 60_000) return;
      lastRun.current = Date.now();
      void fetch('/api/alerts/evaluate', { method: 'POST' }).then(async (response) => {
      if (!response.ok) return; const payload = await response.json();
      if (payload.data?.triggered > 0) window.dispatchEvent(new Event('notifications-updated'));
      }).catch(() => undefined);
    };
    evaluate();
    window.addEventListener('app-active', evaluate);
    window.addEventListener('online', evaluate);
    return () => { window.removeEventListener('app-active', evaluate); window.removeEventListener('online', evaluate); };
  }, [pathname]);
  return null;
}
