/**
 * Disposable Phase C.2 entitlement/capability probe for the options chain that
 * powers Options-Driven Support/Resistance. It answers one question only: does
 * the configured ALPHA_VANTAGE_API_KEY actually return a usable options chain
 * (expirations, call/put strikes, open interest, volume, Greeks) for RKLB?
 *
 * It is intentionally self-contained and imports nothing from the app (mirroring
 * probe-polygon-ws.ts) so it can run under `node --experimental-strip-types`
 * without the bundler's `@/` alias or `server-only` guard.
 *
 * Safety: it never prints the API key, the authenticated URL, raw headers, or
 * any raw provider payload. Only a small allow-list of sanitized capability
 * fields is echoed, and every message is run through sanitize() which redacts
 * the key if it ever appears.
 *
 * Run: npm run probe:options-chain
 */

export {}; // ensure this file is a module so its top-level names never collide with sibling scripts

const BASE_URL = 'https://www.alphavantage.co/query';
const SYMBOL = 'RKLB';
const HARD_DEADLINE_MS = 20_000;

type FailureKind =
  | 'success'
  | 'entitlement-required'
  | 'invalid-key'
  | 'rate-limited'
  | 'no-expirations'
  | 'chain-unavailable'
  | 'timeout'
  | 'provider-unavailable';

interface Capability {
  expirationsAvailable: number;
  chainAvailable: boolean;
  openInterestAvailable: boolean;
  volumeAvailable: boolean;
  greeksAvailable: boolean;
  delayed: boolean;
  failureKind: FailureKind;
  retryable: boolean;
  message: string;
}

const RETRYABLE: Record<FailureKind, boolean> = {
  success: false,
  'entitlement-required': false,
  'invalid-key': false,
  'rate-limited': true,
  'no-expirations': false,
  'chain-unavailable': false,
  timeout: true,
  'provider-unavailable': true,
};

const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
let finished = false;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

/** Redact the key if it ever leaks into a string, and cap length. */
function sanitize(value: unknown): string {
  let text = typeof value === 'string' ? value : '';
  if (apiKey && text.includes(apiKey)) text = text.split(apiKey).join('[redacted-key]');
  return text.slice(0, 200);
}

function finish(capability: Omit<Capability, 'retryable'>): never {
  if (finished) process.exit(process.exitCode ?? 0);
  finished = true;
  if (deadlineTimer) clearTimeout(deadlineTimer);
  const result: Capability = {
    ...capability,
    retryable: RETRYABLE[capability.failureKind],
    message: sanitize(capability.message),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(capability.failureKind === 'success' ? 0 : 1);
}

/** A raw provider row is never echoed; only these booleans are derived from it. */
interface RawRow { expiration?: unknown; type?: unknown; strike?: unknown; open_interest?: unknown; volume?: unknown; delta?: unknown; gamma?: unknown; }

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isNonExpired(expiration: unknown, today: string): boolean {
  return typeof expiration === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiration) && expiration >= today;
}

/**
 * Classify an Alpha Vantage envelope. The provider signals quota/entitlement via
 * a `Note`/`Information` string rather than an HTTP status, so both are checked.
 */
function classifyEnvelope(status: number, payload: Record<string, unknown>): FailureKind | null {
  const note = [payload.Note, payload.Information, payload['Error Message'], payload.message]
    .find((value): value is string => typeof value === 'string');
  if (status === 429 || /frequency|rate limit|call volume|requests per|calls per|daily.*limit/i.test(note ?? '')) return 'rate-limited';
  if (status === 402 || status === 403 || /premium endpoint|subscription|current plan|upgrade.*plan|not entitled|entitlement/i.test(note ?? '')) return 'entitlement-required';
  if (status === 401 || /invalid api key|invalid apikey|api key is invalid/i.test(note ?? '')) return 'invalid-key';
  if (/artificial|demonstration/i.test(note ?? '')) return 'chain-unavailable';
  if (status >= 500) return 'provider-unavailable';
  return null;
}

async function fetchChain(expiration?: string): Promise<{ rows: RawRow[]; failure?: FailureKind }> {
  const url = new URL(BASE_URL);
  url.searchParams.set('function', 'REALTIME_OPTIONS');
  url.searchParams.set('symbol', SYMBOL);
  url.searchParams.set('require_greeks', 'true');
  if (expiration) url.searchParams.set('expiration', expiration);
  url.searchParams.set('apikey', apiKey!);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    let payload: Record<string, unknown> = {};
    try { payload = (await response.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
    const failure = classifyEnvelope(response.status, payload);
    if (failure) return { rows: [], failure };
    const data = Array.isArray(payload.data) ? (payload.data as RawRow[]) : [];
    return { rows: data };
  } catch (cause) {
    const aborted = cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError');
    return { rows: [], failure: aborted ? 'timeout' : 'provider-unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  if (!apiKey) {
    finish({ expirationsAvailable: 0, chainAvailable: false, openInterestAvailable: false, volumeAvailable: false, greeksAvailable: false, delayed: true, failureKind: 'invalid-key', message: 'ALPHA_VANTAGE_API_KEY is not configured in the server environment.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const full = await fetchChain();
  if (full.failure) {
    finish({ expirationsAvailable: 0, chainAvailable: false, openInterestAvailable: false, volumeAvailable: false, greeksAvailable: false, delayed: true, failureKind: full.failure, message: `Full-chain request classified as ${full.failure}.` });
  }

  const expirations = [...new Set(full.rows.map((row) => row.expiration).filter((value) => isNonExpired(value, today)) as string[])].sort();
  if (expirations.length === 0) {
    finish({ expirationsAvailable: 0, chainAvailable: false, openInterestAvailable: false, volumeAvailable: false, greeksAvailable: false, delayed: true, failureKind: 'no-expirations', message: 'Provider returned no non-expired expirations.' });
  }

  // Load one nearest non-expired expiration to verify an expiration-scoped chain.
  const nearest = expirations[0];
  const scoped = await fetchChain(nearest);
  if (scoped.failure) {
    finish({ expirationsAvailable: expirations.length, chainAvailable: false, openInterestAvailable: false, volumeAvailable: false, greeksAvailable: false, delayed: true, failureKind: scoped.failure, message: `Nearest-expiration request classified as ${scoped.failure}.` });
  }

  const rows = scoped.rows.filter((row) => isNonExpired(row.expiration, today));
  const hasCall = rows.some((row) => row.type === 'call' && finiteNumber(row.strike) !== null);
  const hasPut = rows.some((row) => row.type === 'put' && finiteNumber(row.strike) !== null);
  const chainAvailable = hasCall && hasPut;
  const openInterestAvailable = rows.some((row) => finiteNumber(row.open_interest) !== null);
  const volumeAvailable = rows.some((row) => finiteNumber(row.volume) !== null);
  const greeksAvailable = rows.some((row) => finiteNumber(row.delta) !== null && finiteNumber(row.gamma) !== null);

  finish({
    expirationsAvailable: expirations.length,
    chainAvailable,
    openInterestAvailable,
    volumeAvailable,
    greeksAvailable,
    delayed: true,
    failureKind: chainAvailable ? 'success' : 'chain-unavailable',
    message: chainAvailable
      ? `Loaded nearest expiration with ${rows.length} non-expired contracts. Data is treated as DELAYED/EOD, never real-time.`
      : 'Nearest expiration did not return both call and put strikes.',
  });
}

deadlineTimer = setTimeout(() => {
  finish({ expirationsAvailable: 0, chainAvailable: false, openInterestAvailable: false, volumeAvailable: false, greeksAvailable: false, delayed: true, failureKind: 'timeout', message: 'Probe exceeded its hard deadline.' });
}, HARD_DEADLINE_MS);
deadlineTimer.unref();

void main();
