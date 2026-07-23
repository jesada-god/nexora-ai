import { describe, expect, it } from 'vitest';
import type { MarketSnapshot } from '@/src/lib/market-data/realtime';
import { GatewayHub } from './hub';
import type { SendResult, SocketLike } from './socket';

/** Minimal deterministic downstream (browser) socket for hub-only tests. */
class FakeClient implements SocketLike {
  readonly sent: string[] = [];
  private msgCb?: (data: string) => void;
  private closeCb?: () => void;
  send(data: string): SendResult { this.sent.push(data); return 'sent'; }
  isOpen(): boolean { return true; }
  ping(): void {}
  close(): void {}
  detach(): void {}
  onOpen(): void {}
  onMessage(cb: (data: string) => void): void { this.msgCb = cb; }
  onClose(cb: () => void): void { this.closeCb = cb; }
  onError(): void {}
  onPing(): void {}
  onPong(): void {}
  receive(frame: unknown): void { this.msgCb?.(JSON.stringify(frame)); }
  drop(): void { this.closeCb?.(); }
  frames(): Array<Record<string, unknown>> { return this.sent.map((raw) => JSON.parse(raw)); }
  snapshots(): MarketSnapshot[] {
    return this.frames().filter((f) => f.type === 'snapshot').map((f) => f.snapshot as MarketSnapshot);
  }
}

const snapshot = (origin: MarketSnapshot['origin']): MarketSnapshot => ({
  symbol: 'RKLB',
  trade: { kind: 'trade', symbol: 'RKLB', price: 69.71, size: 5, timestampMs: 1_000 },
  quote: null,
  bars: [],
  origin,
  asOfMs: 2_000,
});

const subscribeFrame = { type: 'subscribe', symbols: ['RKLB'], channels: ['trades', 'quotes', 'bars'] };

describe('GatewayHub initial snapshot on subscribe', () => {
  it('serves a warm cache snapshot immediately after the subscribe ack', () => {
    const hub = new GatewayHub({
      feed: 'iex', realtime: true,
      applySubscribe: () => {}, applyUnsubscribe: () => {},
      getSnapshot: () => snapshot('cache'),
    });
    const client = new FakeClient();
    hub.addClient(client);
    client.receive(subscribeFrame);
    expect(client.snapshots()).toHaveLength(1);
    expect(client.snapshots()[0]).toMatchObject({ origin: 'cache', symbol: 'RKLB' });
    // Snapshot arrives after the subscribed ack, before any live event.
    const types = client.frames().map((f) => f.type);
    expect(types.indexOf('subscribed')).toBeLessThan(types.indexOf('snapshot'));
  });

  it('falls back to the async REST bootstrap when the cache is cold, then delivers it', async () => {
    let resolveBootstrap!: (s: MarketSnapshot | null) => void;
    const hub = new GatewayHub({
      feed: 'iex', realtime: true,
      applySubscribe: () => {}, applyUnsubscribe: () => {},
      getSnapshot: () => null,
      bootstrapSnapshot: () => new Promise((resolve) => { resolveBootstrap = resolve; }),
    });
    const client = new FakeClient();
    hub.addClient(client);
    client.receive(subscribeFrame);
    expect(client.snapshots()).toHaveLength(0); // nothing synchronous yet
    resolveBootstrap(snapshot('rest'));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.snapshots()).toHaveLength(1);
    expect(client.snapshots()[0].origin).toBe('rest');
  });

  it('drops a late bootstrap result for a client that already disconnected', async () => {
    let resolveBootstrap!: (s: MarketSnapshot | null) => void;
    const hub = new GatewayHub({
      feed: 'iex', realtime: true,
      applySubscribe: () => {}, applyUnsubscribe: () => {},
      getSnapshot: () => null,
      bootstrapSnapshot: () => new Promise((resolve) => { resolveBootstrap = resolve; }),
    });
    const client = new FakeClient();
    hub.addClient(client);
    client.receive(subscribeFrame);
    client.drop(); // client gone before REST resolves
    resolveBootstrap(snapshot('rest'));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.snapshots()).toHaveLength(0);
  });
});
