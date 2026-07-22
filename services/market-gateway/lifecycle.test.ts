import { describe, expect, it, vi } from 'vitest';
import { GatewayLifecycle, type LifecycleDeps } from './lifecycle';

function makeDeps(overrides: Partial<LifecycleDeps> = {}) {
  const order: string[] = [];
  const pending: Array<() => void> = [];
  const deps: LifecycleDeps = {
    stopUpstream: vi.fn(() => order.push('upstream')),
    closePeers: vi.fn(() => order.push('peers')),
    closeWebSocketServer: vi.fn((done: () => void) => {
      order.push('wss');
      done();
    }),
    closeHttpServer: vi.fn((done: () => void) => {
      order.push('http');
      done();
    }),
    clearTimers: vi.fn(() => order.push('timers')),
    exit: vi.fn((code: number) => order.push(`exit:${code}`)),
    log: vi.fn(),
    // Capture the force-exit timer instead of firing it.
    schedule: (cb: () => void) => {
      pending.push(cb);
      return () => {
        const index = pending.indexOf(cb);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    ...overrides,
  };
  return { deps, order, pending };
}

describe('GatewayLifecycle.shutdown', () => {
  it('tears down in order (timers → upstream → peers → wss → http) then exits', () => {
    const { deps, order, pending } = makeDeps();
    new GatewayLifecycle(deps).shutdown(0, 'SIGTERM');

    expect(order).toEqual(['timers', 'upstream', 'peers', 'wss', 'http', 'exit:0']);
    // The force-exit backstop was cancelled once graceful close completed.
    expect(pending).toHaveLength(0);
  });

  it('is idempotent — a second signal during draining does nothing', () => {
    const { deps, order } = makeDeps();
    const lifecycle = new GatewayLifecycle(deps);
    lifecycle.shutdown(0, 'SIGTERM');
    lifecycle.shutdown(0, 'SIGINT');

    expect(order.filter((step) => step === 'exit:0')).toHaveLength(1);
    expect(deps.stopUpstream).toHaveBeenCalledTimes(1);
  });

  it('force-exits if graceful close never completes', () => {
    const { deps, order, pending } = makeDeps({
      // WS server that never invokes its done callback (hung drain).
      closeWebSocketServer: vi.fn(() => {}),
    });
    new GatewayLifecycle(deps).shutdown(0, 'SIGTERM');
    expect(order).not.toContain('exit:0'); // still hung
    pending.forEach((cb) => cb()); // fire the force-exit timer
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('continues teardown even if one step throws', () => {
    const { deps, order } = makeDeps({
      stopUpstream: vi.fn(() => {
        throw new Error('upstream boom');
      }),
    });
    new GatewayLifecycle(deps).shutdown(0, 'SIGTERM');
    expect(order).toContain('http');
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});

describe('GatewayLifecycle.handleFatal', () => {
  it('logs the sanitized reason, drains, and exits 1 after cleanup', () => {
    const { deps, order } = makeDeps();
    new GatewayLifecycle(deps).handleFatal('uncaughtException', new Error('boom'));

    // Cleanup ran before the non-zero exit — never left in an unknown state.
    expect(order).toEqual(['timers', 'upstream', 'peers', 'wss', 'http', 'exit:1']);
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.log).toHaveBeenCalledWith('error', expect.stringContaining('fatal: uncaughtException'), expect.anything());
  });
});
