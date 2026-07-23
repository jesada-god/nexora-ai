// @vitest-environment jsdom

/**
 * Regression guard for the live-socket visibility signal.
 *
 * The production symptom: a WebSocket opened (101) and subscribed RKLB, then was
 * closed with 1005 the instant the developer clicked into the console — because the
 * socket was gated on {@link useAppActive} (`visible && document.hasFocus()`) and
 * focusing DevTools blurs the window. {@link useAppVisible} decouples the socket
 * from focus: only a genuine tab background/foreground toggles it.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppVisible } from './useAppVisible';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

let latest = false;

function mount(): { unmount: () => void } {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  function Harness(): null { latest = useAppVisible(); return null; }
  act(() => { root.render(React.createElement(Harness)); });
  return { unmount: () => act(() => { root.unmount(); }) };
}

afterEach(() => { setVisibility('visible'); });

describe('useAppVisible', () => {
  it('is visible while the tab is shown, independent of window focus', () => {
    setVisibility('visible');
    const view = mount();
    expect(latest).toBe(true);
    // Losing window focus — focusing the DevTools/console, alt-tabbing while the tab
    // stays on screen, a second monitor — must NOT flip the signal. That focus
    // dependency is exactly what tore the live socket down with a 1005.
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(latest).toBe(true);
    view.unmount();
  });

  it('flips only when the tab is actually backgrounded and foregrounded', () => {
    const view = mount();
    expect(latest).toBe(true);
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(latest).toBe(false);
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(latest).toBe(true);
    view.unmount();
  });
});
