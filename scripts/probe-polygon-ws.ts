/**
 * Disposable Track-1 entitlement probe for the Polygon (Massive) real-time
 * stocks WebSocket. It answers one question only: does the configured
 * POLYGON_API_KEY authenticate AND subscribe on the *real-time* cluster?
 *
 * It is intentionally NOT a browser route and imports nothing from the app.
 * It reads the server-only POLYGON_API_KEY, connects to the official real-time
 * endpoint, authenticates, attempts a single small aggregate subscription for
 * RKLB, waits for the auth/subscribe replies plus at most one market event,
 * and exits within HARD_DEADLINE_MS with a single sanitized JSON line.
 *
 * Safety: it never prints the API key, the authenticated URL, raw headers, or
 * any raw provider payload. Only a small allow-list of fields is echoed, and
 * every string is run through sanitize() which redacts the key if it ever
 * appears.
 *
 * Run: npm run probe:polygon-ws
 */

export {}; // ensure this file is a module so its top-level names never collide with sibling scripts

// The real-time stocks cluster. A delayed-only plan cannot authenticate here
// (it must use delayed.polygon.io), which is exactly what makes this a valid
// real-time entitlement test. Overridable only for local experimentation.
const WS_URL = process.env.POLYGON_WS_URL || 'wss://socket.polygon.io/stocks';
const SYMBOL = 'RKLB';
// A.<sym> is the smallest real-time aggregate channel (per-second bars). It
// carries the same real-time entitlement as trades but far less bandwidth.
const CHANNEL = `A.${SYMBOL}`;
const HARD_DEADLINE_MS = 15_000;
// After auth+subscribe succeed we linger briefly for a live event, but never
// past the hard deadline.
const EVENT_WAIT_MS = 8_000;

type EffectiveMode = 'real-time' | 'delayed' | 'unauthorized' | 'unknown';
type FailureKind =
  | 'invalid-key'
  | 'entitlement-required'
  | 'rate-limited'
  | 'market-closed-no-event'
  | 'timeout'
  | 'provider-unavailable'
  | 'success';

interface ProbeResult {
  connected: boolean;
  authenticated: boolean;
  subscribed: boolean;
  eventReceived: boolean;
  effectiveMode: EffectiveMode;
  failureKind: FailureKind;
  providerCode: string | null;
  retryable: boolean;
  message: string;
}

const RETRYABLE: Record<FailureKind, boolean> = {
  'invalid-key': false,
  'entitlement-required': false,
  'rate-limited': true,
  'market-closed-no-event': false,
  timeout: true,
  'provider-unavailable': true,
  success: false,
};

const state = {
  connected: false,
  authenticated: false,
  subscribed: false,
  eventReceived: false,
  providerCode: null as string | null,
  authMessage: null as string | null,
  subscribeError: null as string | null,
};

const apiKey = process.env.POLYGON_API_KEY?.trim();

/** Redact the key if it ever leaks into a provider string, and cap length. */
function sanitize(value: unknown): string {
  let text = typeof value === 'string' ? value : '';
  if (apiKey && text.includes(apiKey)) text = text.split(apiKey).join('[redacted-key]');
  return text.slice(0, 200);
}

/** US regular-session heuristic (ignores holidays) used only to distinguish a
 *  legitimate "subscribed but no event because the market is closed" outcome
 *  from a real failure. It is never used to prove entitlement. */
function isRegularSessionOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (['Sat', 'Sun'].includes(weekday)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** Classify entitlement vs invalid-key from a provider auth/error message. */
function looksLikeEntitlement(message: string): boolean {
  return /not authorized|unauthorized|entitle|permission|subscription|upgrade|delayed|access denied|not.*allowed/i.test(message);
}
function looksLikeInvalidKey(message: string): boolean {
  return /invalid|unknown api ?key|bad|incorrect|not found|no api ?key/i.test(message);
}
function looksLikeRateLimited(message: string): boolean {
  return /rate|too many|maximum.*connection|max.*connection|limit exceeded/i.test(message);
}

let finished = false;
let ws: WebSocket | null = null;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;

function finish(partial: Pick<ProbeResult, 'failureKind' | 'effectiveMode'> & { message: string }): void {
  if (finished) return;
  finished = true;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (eventTimer) clearTimeout(eventTimer);
  try { ws?.close(); } catch { /* already closing */ }

  const result: ProbeResult = {
    connected: state.connected,
    authenticated: state.authenticated,
    subscribed: state.subscribed,
    eventReceived: state.eventReceived,
    effectiveMode: partial.effectiveMode,
    failureKind: partial.failureKind,
    providerCode: state.providerCode,
    retryable: RETRYABLE[partial.failureKind],
    message: sanitize(partial.message),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.failureKind === 'success' || result.failureKind === 'market-closed-no-event' ? 0 : 1;
  // Give the close frame a moment, then hard-exit so a lingering socket cannot
  // keep the process alive past the deadline.
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
}

/** Decide the outcome from the current state when we stop waiting. */
function settleFromState(reason: 'deadline' | 'event-window'): void {
  if (state.eventReceived) {
    finish({ failureKind: 'success', effectiveMode: 'real-time', message: 'Authenticated, subscribed, and received a live real-time event.' });
    return;
  }
  if (state.subscribed) {
    // Auth + subscribe both proven => real-time entitlement is confirmed. A
    // missing event when the market is closed is expected, NOT a failure.
    if (!isRegularSessionOpen()) {
      finish({ failureKind: 'market-closed-no-event', effectiveMode: 'real-time', message: 'Authenticated and subscribed on the real-time cluster; no event because the US market is closed. Real-time entitlement is confirmed.' });
      return;
    }
    finish({ failureKind: 'success', effectiveMode: 'real-time', message: 'Authenticated and subscribed on the real-time cluster; no event arrived within the wait window (low trade activity), but real-time entitlement is confirmed by the accepted subscription.' });
    return;
  }
  if (state.authenticated) {
    finish({ failureKind: 'timeout', effectiveMode: 'unknown', message: `Authenticated but the subscription reply did not arrive before the ${reason}. Cannot confirm real-time.` });
    return;
  }
  if (state.connected) {
    finish({ failureKind: 'timeout', effectiveMode: 'unknown', message: `Connected but authentication did not complete before the ${reason}.` });
    return;
  }
  finish({ failureKind: 'provider-unavailable', effectiveMode: 'unknown', message: `Could not establish a WebSocket session before the ${reason}.` });
}

function handleStatus(status: string, rawMessage: string): void {
  state.providerCode = status;
  const message = sanitize(rawMessage);

  switch (status) {
    case 'connected':
      state.connected = true;
      return;
    case 'auth_success':
      state.authenticated = true;
      ws?.send(JSON.stringify({ action: 'subscribe', params: CHANNEL }));
      return;
    case 'auth_failed':
    case 'auth_timeout': {
      state.authMessage = message;
      if (looksLikeEntitlement(message) && !looksLikeInvalidKey(message)) {
        finish({ failureKind: 'entitlement-required', effectiveMode: 'unauthorized', message: message || 'Authentication rejected: the plan is not entitled to the real-time cluster.' });
      } else if (looksLikeRateLimited(message)) {
        finish({ failureKind: 'rate-limited', effectiveMode: 'unknown', message: message || 'Authentication rate limited.' });
      } else {
        finish({ failureKind: 'invalid-key', effectiveMode: 'unknown', message: message || 'Authentication failed: the API key was rejected.' });
      }
      return;
    }
    case 'max_connections':
      finish({ failureKind: 'rate-limited', effectiveMode: 'unknown', message: message || 'Maximum number of concurrent connections reached.' });
      return;
    case 'success':
      // Polygon replies success for both the initial auth handshake and the
      // subscribe. Treat a success mentioning the channel as the subscription.
      if (/subscrib/i.test(message) || message.includes(CHANNEL)) {
        state.subscribed = true;
        // Now wait a short window for one live event, bounded by the deadline.
        if (eventTimer) clearTimeout(eventTimer);
        eventTimer = setTimeout(() => settleFromState('event-window'), EVENT_WAIT_MS);
      }
      return;
    case 'error': {
      if (looksLikeRateLimited(message)) {
        finish({ failureKind: 'rate-limited', effectiveMode: 'unknown', message });
      } else if (looksLikeEntitlement(message)) {
        finish({ failureKind: 'entitlement-required', effectiveMode: 'unauthorized', message: message || 'Subscription rejected: not entitled to this real-time channel.' });
      } else {
        finish({ failureKind: 'provider-unavailable', effectiveMode: 'unknown', message: message || 'Provider returned an error status.' });
      }
      return;
    }
    default:
      // Unknown status codes are recorded but not fatal on their own.
      return;
  }
}

function handleMessage(raw: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const ev = typeof record.ev === 'string' ? record.ev : '';
    if (ev === 'status') {
      handleStatus(String(record.status ?? ''), String(record.message ?? ''));
      continue;
    }
    // Any non-status message for our channel is a live market event.
    if (ev && (ev === 'A' || ev === 'AM' || ev === 'T' || ev === 'Q')) {
      state.eventReceived = true;
      finish({ failureKind: 'success', effectiveMode: 'real-time', message: `Authenticated, subscribed, and received a live '${ev}' event for ${SYMBOL}.` });
      return;
    }
  }
}

function main(): void {
  if (!apiKey) {
    finish({ failureKind: 'invalid-key', effectiveMode: 'unknown', message: 'POLYGON_API_KEY is not configured in the server environment.' });
    return;
  }

  deadlineTimer = setTimeout(() => settleFromState('deadline'), HARD_DEADLINE_MS);

  try {
    ws = new WebSocket(WS_URL);
  } catch (cause) {
    finish({ failureKind: 'provider-unavailable', effectiveMode: 'unknown', message: `Could not open a WebSocket: ${cause instanceof Error ? cause.message : 'unknown error'}` });
    return;
  }

  ws.addEventListener('open', () => {
    state.connected = true;
    // Auth params carry the key; this outgoing frame is never logged.
    ws?.send(JSON.stringify({ action: 'auth', params: apiKey }));
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    handleMessage(typeof data === 'string' ? data : String(data));
  });

  ws.addEventListener('error', () => {
    // The WebSocket error event exposes no useful detail and may reference the
    // URL; do not echo it. A close/timeout follows and settles the outcome.
    if (!state.connected) {
      finish({ failureKind: 'provider-unavailable', effectiveMode: 'unknown', message: 'WebSocket transport error before a session was established (network blocked or endpoint unreachable).' });
    }
  });

  ws.addEventListener('close', () => {
    if (!finished) settleFromState('deadline');
  });
}

main();
