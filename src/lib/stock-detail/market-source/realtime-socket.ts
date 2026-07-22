/**
 * Browser-side socket abstraction for the live {@link WebSocketMarketSourceImpl}.
 *
 * The source talks to this interface, not to the global `WebSocket`, so tests
 * drive a deterministic fake and never open a real connection. The default
 * factory adapts the browser `WebSocket` (connecting only to the Gateway URL —
 * never to Alpaca, and never with any Alpaca secret).
 */
export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: unknown) => void): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

/** Adapt a browser `WebSocket` to {@link RealtimeSocket}. */
export const browserSocketFactory: RealtimeSocketFactory = (url) => {
  const socket = new WebSocket(url);
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onOpen: (listener) => socket.addEventListener('open', () => listener()),
    onMessage: (listener) => socket.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      listener(typeof data === 'string' ? data : String(data));
    }),
    onClose: (listener) => socket.addEventListener('close', () => listener()),
    onError: (listener) => socket.addEventListener('error', (event) => listener(event)),
  };
};
