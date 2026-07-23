'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tracks whether the browser TAB is currently visible — deliberately independent
 * of window/OS focus.
 *
 * This is the correct gate for a live market WebSocket. {@link useAppActive} also
 * requires `document.hasFocus()`, which turns to `false` the instant focus moves
 * to another window on the same visible screen — the DevTools/console panel, a
 * split-screen app, a second monitor, or the OS taskbar. Gating the live socket on
 * that signal tore the connection down (a bare `close()` → code 1005) the moment a
 * developer clicked into the console to read the logs, and did the same to real
 * users who merely alt-tabbed while the tab stayed on screen. A visibility-only
 * signal keeps the socket alive while the tab is shown and still releases it when
 * the tab is genuinely backgrounded/minimised.
 */
function subscribe(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => {
    document.removeEventListener('visibilitychange', callback);
  };
}

export function useAppVisible() {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === 'visible',
    () => true,
  );
}
