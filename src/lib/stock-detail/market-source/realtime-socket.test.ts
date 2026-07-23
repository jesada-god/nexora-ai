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
  readonly closeArgs: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  send(): void {}
  close(code?: number, reason?: string): void {
    this.closeCount += 1;
    this.closeArgs.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

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

  it('sends an explicit 1000 + reason for an intentional close (not a bare 1005)', () => {
    const socket = browserSocketFactory('wss://gw.example/ws');
    const ws = FakeWebSocket.instances[0];
    ws.fireOpen();

    socket.close('tab-hidden');
    // A bare close() yields code 1005 ("no status received"); an intentional client
    // teardown must be a legible normal-closure code with a reason instead.
    expect(ws.closeArgs.at(-1)).toEqual({ code: 1000, reason: 'tab-hidden' });
  });

  it('defers the reason too and applies 1000 + reason once the handshake completes', () => {
    const socket = browserSocketFactory('wss://gw.example/ws');
    const ws = FakeWebSocket.instances[0];

    socket.close('tab-hidden'); // requested while CONNECTING → deferred
    expect(ws.closeCount).toBe(0);

    ws.fireOpen();
    expect(ws.closeArgs.at(-1)).toEqual({ code: 1000, reason: 'tab-hidden' });
  });

  it('still sends a bare close when no reason is given', () => {
    const socket = browserSocketFactory('wss://gw.example/ws');
    const ws = FakeWebSocket.instances[0];
    ws.fireOpen();

    socket.close();
    expect(ws.closeArgs.at(-1)).toEqual({ code: undefined, reason: undefined });
  });
});
