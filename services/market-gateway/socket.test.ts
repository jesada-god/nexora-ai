import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { WebSocket as WsWebSocket } from 'ws';
import { fromWs } from './socket';

/**
 * The `ws` library throws synchronously from `send()` whenever the socket is not
 * OPEN ("WebSocket is not open: readyState N"). These tests pin the adapter's
 * contract: it must translate that hazard into a value, never a throw — that is
 * the whole reason the Gateway stopped crashing on reconnect.
 */
class FakeWs extends EventEmitter {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  send = vi.fn((data: string) => {
    if (this.readyState !== 1) throw new Error(`WebSocket is not open: readyState ${this.readyState}`);
    this.sent.push(data);
  });
  // Mirror ws: ping() also throws synchronously unless OPEN.
  ping = vi.fn(() => {
    if (this.readyState !== 1) throw new Error(`WebSocket is not open: readyState ${this.readyState}`);
  });
  close = vi.fn();
}

function adapt(ws: FakeWs) {
  return fromWs(ws as unknown as WsWebSocket);
}

describe('fromWs adapter', () => {
  it('drops (does not throw) when sending while CONNECTING/CLOSING/CLOSED', () => {
    const ws = new FakeWs();
    const socket = adapt(ws);
    for (const readyState of [0, 2, 3]) {
      ws.readyState = readyState;
      expect(() => socket.send('x')).not.toThrow();
      expect(socket.send('x')).toBe('dropped');
    }
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('sends and reports "sent" only while OPEN', () => {
    const ws = new FakeWs();
    const socket = adapt(ws);
    ws.readyState = 1; // OPEN
    expect(socket.isOpen()).toBe(true);
    expect(socket.send('hello')).toBe('sent');
    expect(ws.sent).toEqual(['hello']);
  });

  it('pings only while OPEN and never throws when the socket is not OPEN', () => {
    const ws = new FakeWs();
    const socket = adapt(ws);

    ws.readyState = 0; // CONNECTING
    expect(() => socket.ping()).not.toThrow();
    expect(ws.ping).not.toHaveBeenCalled(); // guarded before the throwing call

    ws.readyState = 1; // OPEN
    socket.ping();
    expect(ws.ping).toHaveBeenCalledTimes(1);
  });

  it('detach removes listeners and swallows a late error instead of crashing', () => {
    const ws = new FakeWs();
    const socket = adapt(ws);
    const onClose = vi.fn();
    socket.onClose(onClose);

    socket.detach();
    ws.emit('close');
    expect(onClose).not.toHaveBeenCalled(); // listener removed

    // A ws EventEmitter with no 'error' listener re-throws; detach must leave a sink.
    expect(() => ws.emit('error', new Error('late'))).not.toThrow();
  });
});
