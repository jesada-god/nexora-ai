import { z } from 'zod';
import { MARKET_CHANNELS, normalizedMarketEventSchema } from './events';

/**
 * The control protocol spoken between the **browser** and the **Gateway**.
 *
 * The browser never speaks Alpaca's wire protocol and never holds Alpaca
 * credentials; it speaks only this framing to `NEXT_PUBLIC_MARKET_WS_URL`. The
 * Gateway owns the single upstream Alpaca connection and translates. Every frame
 * in both directions is validated with these schemas, so a malformed line is
 * rejected instead of crashing a client or the Gateway.
 */

const channelList = z.array(z.enum(MARKET_CHANNELS)).min(1);
const symbolList = z.array(z.string().min(1)).min(1);

/* ------------------------------- browser → Gateway ------------------------------- */

export const subscribeFrameSchema = z.object({
  type: z.literal('subscribe'),
  symbols: symbolList,
  channels: channelList,
});

export const unsubscribeFrameSchema = z.object({
  type: z.literal('unsubscribe'),
  symbols: symbolList,
  channels: channelList,
});

/** Application-level heartbeat so a client can prove liveness independent of TCP. */
export const pingFrameSchema = z.object({
  type: z.literal('ping'),
  t: z.number().int().nonnegative(),
});

export const clientFrameSchema = z.discriminatedUnion('type', [
  subscribeFrameSchema,
  unsubscribeFrameSchema,
  pingFrameSchema,
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

/* ------------------------------- Gateway → browser ------------------------------- */

/**
 * Sent once the Gateway's upstream is authenticated and ready. `realtime` is the
 * Gateway's honest claim about the upstream feed: `true` only for an entitled
 * live IEX stream, `false` for the `test`/FAKEPACA sandbox. The UI must never
 * label data "Real-time" when this is false.
 */
export const connectedFrameSchema = z.object({
  type: z.literal('connected'),
  feed: z.string(),
  realtime: z.boolean(),
});

export const subscribedFrameSchema = z.object({
  type: z.literal('subscribed'),
  symbols: z.array(z.string()),
  channels: z.array(z.enum(MARKET_CHANNELS)),
});

/** A single normalized market event fanned out to interested clients. */
export const eventFrameSchema = z.object({
  type: z.literal('event'),
  event: normalizedMarketEventSchema,
});

export const errorFrameSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const pongFrameSchema = z.object({
  type: z.literal('pong'),
  t: z.number().int().nonnegative(),
});

/** Emitted when a subscribe would exceed the Gateway's hard symbol cap. */
export const limitExceededFrameSchema = z.object({
  type: z.literal('limit-exceeded'),
  limit: z.number().int().positive(),
  requested: z.array(z.string()),
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
});

export const serverFrameSchema = z.discriminatedUnion('type', [
  connectedFrameSchema,
  subscribedFrameSchema,
  eventFrameSchema,
  errorFrameSchema,
  pongFrameSchema,
  limitExceededFrameSchema,
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;

/** Parse a raw text frame from the socket into a validated client frame. */
export function parseClientFrame(raw: string): ClientFrame | null {
  return safeParseJson(raw, clientFrameSchema);
}

/** Parse a raw text frame from the socket into a validated server frame. */
export function parseServerFrame(raw: string): ServerFrame | null {
  return safeParseJson(raw, serverFrameSchema);
}

function safeParseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
