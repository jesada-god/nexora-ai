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
  /**
   * Close the socket. `reason` (≤123 UTF-8 bytes) makes an INTENTIONAL client
   * close explicit on the wire — a normal-closure code `1000` with a human reason
   * instead of the ambiguous bare-`close()` code `1005` ("no status received").
   */
  close(reason?: string): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
  onError(listener: (error: unknown) => void): void;
}

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

/** Adapt a browser `WebSocket` to {@link RealtimeSocket}. */
export const browserSocketFactory: RealtimeSocketFactory = (url) => {
  // Temporary, secret-free lifecycle diagnostics. The Gateway URL is public
  // (`NEXT_PUBLIC_*`); no credential is ever logged.
  console.info('[market-ws] connecting', url);
  const socket = new WebSocket(url);
  // A close requested while the socket is still `CONNECTING` is deferred to the
  // `open` handler. Calling `WebSocket.close()` on a CONNECTING socket makes the
  // browser log "WebSocket is closed before the connection is established" and
  // drop the connection with code 1006 — exactly the production symptom when a
  // transient React unmount / visibility blur tore the socket down mid-handshake.
  // Deferring lets the handshake finish (101) and only then closes cleanly.
  let closeRequested = false;
  let closeReason = '';
  let openListener: (() => void) | undefined;
  // A normal-closure code with a short, secret-free reason. Bare `close()` sends
  // code 1005 ("no status received"), which is indistinguishable from an abnormal
  // drop; an explicit 1000 + reason makes an intentional client teardown legible
  // in the browser Network panel and in the Gateway's close logs.
  const NORMAL_CLOSURE = 1000;
  const closeNow = (reason: string): void => {
    if (reason) socket.close(NORMAL_CLOSURE, reason.slice(0, 120));
    else socket.close();
  };
  socket.addEventListener('open', () => {
    if (closeRequested) {
      closeNow(closeReason);
      return;
    }
    console.info('[market-ws] open');
    openListener?.();
  });
  return {
    send: (data) => socket.send(data),
    close: (reason = '') => {
      if (socket.readyState === WebSocket.CONNECTING) {
        // Defer until the handshake finishes; closing a CONNECTING socket trips the
        // browser's "closed before the connection is established" warning (1006).
        closeRequested = true;
        closeReason = reason;
        return;
      }
      closeNow(reason);
    },
    onOpen: (listener) => { openListener = listener; },
    onMessage: (listener) => socket.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      listener(typeof data === 'string' ? data : String(data));
    }),
    onClose: (listener) => socket.addEventListener('close', (event) => {
      const closeEvent = event as CloseEvent;
      console.info('[market-ws] closed', closeEvent.code, closeEvent.reason || '(no-reason)');
      listener();
    }),
    onError: (listener) => socket.addEventListener('error', (event) => {
      console.error('[market-ws] error');
      listener(event);
    }),
  };
};
