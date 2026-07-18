'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  window.addEventListener('focus', callback);
  window.addEventListener('blur', callback);
  return () => {
    document.removeEventListener('visibilitychange', callback);
    window.removeEventListener('focus', callback);
    window.removeEventListener('blur', callback);
  };
}

export function useAppActive() {
  return useSyncExternalStore(subscribe, () => document.visibilityState === 'visible' && document.hasFocus(), () => true);
}
