'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function AlertEvaluationOnOpen() {
  const pathname = usePathname();
  const lastRun = useRef(0);

  useEffect(() => {
    if (pathname.startsWith('/auth/')) {
      return;
    }

    const evaluate = async () => {
      const isCoolingDown =
        Date.now() - lastRun.current < 2 * 60_000;

      if (
        !navigator.onLine ||
        document.visibilityState !== 'visible' ||
        isCoolingDown
      ) {
        return;
      }

      lastRun.current = Date.now();

      try {
        const response = await fetch('/api/alerts/evaluate', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
          cache: 'no-store',
        });

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          console.warn('Alert evaluation failed', {
            status: response.status,
          });
          return;
        }

        const payload = await response.json();

        if (payload.data?.triggered > 0) {
          window.dispatchEvent(
            new Event('notifications-updated'),
          );
        }
      } catch {
        // ไม่แสดง error เมื่อออฟไลน์หรือ request ถูกยกเลิก
      }
    };

    void evaluate();

    const handleAppActive = () => {
      void evaluate();
    };

    const handleOnline = () => {
      void evaluate();
    };

    window.addEventListener('app-active', handleAppActive);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener(
        'app-active',
        handleAppActive,
      );

      window.removeEventListener(
        'online',
        handleOnline,
      );
    };
  }, [pathname]);

  return null;
}