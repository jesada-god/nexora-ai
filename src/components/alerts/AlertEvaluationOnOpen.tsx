'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  AlertEvaluationRequestError,
  requestAlertEvaluation,
} from '@/src/lib/alerts/client';

export function AlertEvaluationOnOpen() {
  const pathname = usePathname();
  const lastRun = useRef(0);

  useEffect(() => {
    if (pathname.startsWith('/auth/')) {
      return;
    }

    let active = true;

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
        const response = await requestAlertEvaluation();

        if (!active) {
          return;
        }

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
      } catch (error) {
        if (
          error instanceof AlertEvaluationRequestError &&
          error.status === 401
        ) {
          return;
        }

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
      active = false;

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
