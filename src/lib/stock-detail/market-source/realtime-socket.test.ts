import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserSocketFactory } from './realtime-socket';

/** Minimal stand-in for the browser `WebSocket` with a controllable readyState. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  closeCount = 0;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  send(): void {}
  close(): void { this.closeCount += 1; this.readyState = FakeWebSocket.CLOSED; }

  fireOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const cb of this.listeners.get('open') ?? []) cb(new Event('open'));
  }
}

describe('browserSocketFactory close-while-connecting guard', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  });

  it('defers a close requested while CONNECTING and closes once open', () => {
    const socket = browserSocketFactory('wss://gw.example/ws');
    const ws = FakeWebSocket.instances[0];
    expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

    // A close requested mid-handshake must NOT call the underlying close() — that
    // is exactly what produced "closed before the connection is established" (1006).
    socket.close();
    expect(ws.closeCount).toBe(0);

    // When the handshake finally completes, the deferred close is applied and the
    // onOpen listener is NOT delivered (we no longer want this socket).
    const onOpen = vi.fn();
    socket.onOpen(onOpen);
    ws.fireOpen();
    expect(ws.closeCount).toBe(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('delivers onOpen and closes immediately when already OPEN', () => {
    const socket = browserSocketFactory('wss://gw.example/ws');
    const ws = FakeWebSocket.instances[0];
    const onOpen = vi.fn();
    socket.onOpen(onOpen);

    ws.fireOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    socket.close(); // OPEN → close immediately
    expect(ws.closeCount).toBe(1);
  });
});
