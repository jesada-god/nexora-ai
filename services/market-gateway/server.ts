import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { resolveAlpacaConfig } from '@/src/lib/market-data/realtime';
import { GatewayHub } from './hub';
import { UpstreamConnection } from './upstream';
import { fromWs } from './socket';
import { GatewayLifecycle } from './lifecycle';
import {
  buildHealthReport,
  ConnectionRateGuard,
  CONNECTION_RATE_LIMIT,
  CONNECTION_RATE_WINDOW_MS,
  HEALTH_PATH,
  isDevelopment,
  isOriginAllowed,
  MAX_MESSAGE_BYTES,
  resolveAllowedOrigins,
  resolveGatewayPort,
  sanitizeError,
  SlidingWindowRateLimiter,
  SUBSCRIBE_RATE_LIMIT,
  SUBSCRIBE_RATE_WINDOW_MS,
  WS_PATH,
} from './runtime';

/**
 * Standalone Node WebSocket Gateway entrypoint — the composition root for the
 * production deployment gate. All policy lives in the tested `runtime` and
 * `lifecycle` modules; this file only wires them to the live `http`/`ws`
 * servers and the process signals.
 *
 * This is a LONG-LIVED process and MUST NOT run inside a Next.js/Vercel route
 * handler: serverless functions are request-scoped and cannot hold the single
 * persistent upstream socket this service owns. Deploy it as its own always-on
 * Node service (Railway / Render / Fly / a container) and point
 * `NEXT_PUBLIC_MARKET_WS_URL` at it.
 *
 *   npm run gateway   # reads .env.local for ALPACA_* + MARKET_REALTIME_ENABLED
 *
 * Exactly ONE upstream Alpaca connection exists per instance. Scale horizontally
 * by running more instances behind the load balancer, never by opening a second
 * upstream socket here. Secrets are read only via resolveAlpacaConfig and never
 * reach a client, a health response, or a log line.
 */
function main(): void {
  const config = resolveAlpacaConfig();
  if (!config.enabled) {
    console.error(`[gateway] disabled: ${config.reason}. Set MARKET_REALTIME_ENABLED and ALPACA_* to enable.`);
    process.exit(1);
    return;
  }

  const secrets = [config.keyId, config.secretKey] as const;
  const log = (level: 'info' | 'error', message: string, detail?: unknown): void => {
    const line = `[gateway] ${message}`;
    if (detail === undefined) console[level === 'info' ? 'log' : 'error'](line);
    else console[level === 'info' ? 'log' : 'error'](line, sanitizeError(detail, secrets));
  };

  const port = resolveGatewayPort();
  const development = isDevelopment();
  const allowedOrigins = resolveAllowedOrigins();
  const connectionGuard = new ConnectionRateGuard(CONNECTION_RATE_LIMIT, CONNECTION_RATE_WINDOW_MS);
  const startedAt = Date.now();

  // --- Upstream + fan-out hub (one upstream connection per instance) ---
  const hub = new GatewayHub({
    feed: config.feed,
    realtime: config.realtime,
    applySubscribe: (refs) => upstream.subscribe(refs),
    applyUnsubscribe: (refs) => upstream.unsubscribe(refs),
    createRateLimiter: () => new SlidingWindowRateLimiter(SUBSCRIBE_RATE_LIMIT, SUBSCRIBE_RATE_WINDOW_MS),
  });

  const upstream = new UpstreamConnection({
    config: { url: config.url, keyId: config.keyId, secretKey: config.secretKey },
    createSocket: (url) => fromWs(new WebSocket(url)),
    onEvent: (event) => hub.handleUpstreamEvent(event),
    getSubscriptions: () => hub.subscriptionSnapshot(),
    onStateChange: (state) => log('info', `upstream ${state}`),
    staleTimeoutMs: 30_000,
  });

  // --- HTTP server: /healthz + the WebSocket upgrade endpoint on one port ---
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === HEALTH_PATH) {
      const report = buildHealthReport({ upstreamState: upstream.getState(), feed: config.feed, startedAt });
      const body = JSON.stringify(report);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  wss.on('error', (error) => log('error', 'wss error', error));

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return rejectUpgrade(socket, 404, 'Not Found');

    if (!isOriginAllowed(req.headers.origin, { allowedOrigins, development })) {
      log('error', `rejected upgrade: origin not allowed (${req.headers.origin ?? 'none'})`);
      return rejectUpgrade(socket, 403, 'Forbidden');
    }

    const ip = req.socket.remoteAddress ?? 'unknown';
    if (!connectionGuard.allow(ip)) {
      log('error', 'rejected upgrade: connection rate exceeded');
      return rejectUpgrade(socket, 429, 'Too Many Requests');
    }

    wss.handleUpgrade(req, socket, head, (peer) => {
      peer.on('error', (error) => log('error', 'peer error', error));
      hub.addClient(fromWs(peer));
    });
  });

  // --- Ordered teardown for signals + fatal errors ---
  const lifecycle = new GatewayLifecycle({
    stopUpstream: () => upstream.stop(),
    closePeers: () => {
      for (const peer of wss.clients) {
        try {
          peer.terminate();
        } catch {
          // already gone
        }
      }
    },
    closeWebSocketServer: (done) => wss.close(() => done()),
    closeHttpServer: (done) => httpServer.close(() => done()),
    clearTimers: () => {
      /* upstream owns its own timers and is stopped above; nothing else here */
    },
    exit: (code) => process.exit(code),
    log,
  });

  process.on('SIGTERM', () => lifecycle.shutdown(0, 'SIGTERM'));
  process.on('SIGINT', () => lifecycle.shutdown(0, 'SIGINT'));
  // A fatal error must never leave the process in an unknown state: log it
  // sanitized, drain every resource, then exit non-zero so the platform can
  // restart a clean instance.
  process.on('uncaughtException', (error) => lifecycle.handleFatal('uncaughtException', error));
  process.on('unhandledRejection', (reason) => lifecycle.handleFatal('unhandledRejection', reason));

  httpServer.on('error', (error) => log('error', 'http server error', error));
  httpServer.listen(port, '0.0.0.0', () => {
    log('info', `listening on 0.0.0.0:${port} · ws=${WS_PATH} · health=${HEALTH_PATH} · feed=${config.feed} · realtime=${config.realtime}`);
    upstream.start();
  });
}

/** Reject a WebSocket upgrade with a minimal HTTP response, then close. */
function rejectUpgrade(socket: Socket, code: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {
    // socket may already be gone
  }
  socket.destroy();
}

main();
