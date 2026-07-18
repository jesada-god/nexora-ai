import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/src/types/database';
import type { MarketDataProvider, ProviderResult, Quote } from '@/src/lib/market-data/types';
import { MarketDataError } from '@/src/lib/market-data/errors';
import { describeCondition } from './logic';
import { deliverPendingPushes } from '@/src/lib/push/service';

const BATCH_SIZE = 5;
const MIN_EVALUATION_INTERVAL_MS = 15 * 60_000;
const SCHEDULE_WINDOW_MS = 15 * 60_000;

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getQuoteWithRetry(provider: MarketDataProvider, symbol: string): Promise<ProviderResult<Quote>> {
  try { return await provider.getQuote(symbol); }
  catch (cause) {
    if (!(cause instanceof MarketDataError) || !cause.retryable || cause.code === 'rate-limited') throw cause;
    await sleep(Math.min(2_000, (cause.retryAfterSeconds ?? 1) * 1_000));
    return provider.getQuote(symbol);
  }
}

function windowStart(now: Date): string {
  return new Date(Math.floor(now.getTime() / SCHEDULE_WINDOW_MS) * SCHEDULE_WINDOW_MS).toISOString();
}

function idempotencyKey(alertId: string, cooldownMinutes: number, now: Date): string {
  const bucketMs = Math.max(1, cooldownMinutes) * 60_000;
  const bucket = Math.floor(now.getTime() / bucketMs);
  return createHash('sha256').update(`${alertId}:${bucket}`).digest('hex');
}

export interface BackgroundAlertSummary {
  duplicateRun: boolean;
  evaluated: number;
  triggered: number;
  unavailable: number;
  pushSent: number;
  pushFailed: number;
  pushDeferred: number;
  subscriptionsCleaned: number;
}

export async function runBackgroundAlerts(client: SupabaseClient<Database>, provider: MarketDataProvider, now = new Date()): Promise<BackgroundAlertSummary> {
  const scheduleWindow = windowStart(now);
  const empty: BackgroundAlertSummary = { duplicateRun: false, evaluated: 0, triggered: 0, unavailable: 0, pushSent: 0, pushFailed: 0, pushDeferred: 0, subscriptionsCleaned: 0 };
  let { data: run, error: runError } = await client.from('alert_evaluation_runs').insert({ schedule_window: scheduleWindow }).select('id').maybeSingle();
  if (runError?.code === '23505') {
    const { data: existing, error: existingError } = await client.from('alert_evaluation_runs').select('id, status').eq('schedule_window', scheduleWindow).maybeSingle();
    if (existingError || !existing) throw existingError ?? new Error('Could not inspect alert run');
    if (existing.status !== 'failed') return { ...empty, duplicateRun: true };
    const { data: resumed, error: resumeError } = await client.from('alert_evaluation_runs').update({ status: 'running', error_code: null,
      started_at: now.toISOString(), completed_at: null }).eq('id', existing.id).eq('status', 'failed').select('id').maybeSingle();
    if (resumeError || !resumed) return { ...empty, duplicateRun: true };
    run = resumed; runError = null;
  }
  if (runError || !run) throw runError ?? new Error('Could not start alert run');

  try {
    const cutoff = new Date(now.getTime() - MIN_EVALUATION_INTERVAL_MS).toISOString();
    const { data: alerts, error } = await client.from('price_alerts').select('*').eq('enabled', true)
      .or(`last_evaluated_at.is.null,last_evaluated_at.lt.${cutoff}`)
      .order('last_evaluated_at', { ascending: true, nullsFirst: true }).limit(BATCH_SIZE);
    if (error) throw error;

    const uniqueSymbols = [...new Set((alerts ?? []).map((alert) => alert.symbol))];
    const quotes = new Map<string, ProviderResult<Quote>>();
    for (const symbol of uniqueSymbols) {
      try { quotes.set(symbol, await getQuoteWithRetry(provider, symbol)); }
      catch { empty.unavailable += 1; }
    }

    for (const alert of alerts ?? []) {
      const quote = quotes.get(alert.symbol);
      if (!quote) {
        await client.from('price_alerts').update({ last_evaluated_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', alert.id);
        continue;
      }
      const observedAt = now.toISOString();
      const condition = describeCondition(alert.condition, Number(alert.target_value));
      const title = `${alert.symbol} ตรงตาม Price Alert`;
      const message = `${condition} — ราคาที่ตรวจพบ ${quote.data.price.toLocaleString()}${quote.data.changePercent == null ? '' : ` (${quote.data.changePercent.toFixed(2)}%)`}`;
      const { data: notificationId, error: triggerError } = await client.rpc('trigger_price_alert_service', {
        alert_id: alert.id, observed_price: quote.data.price, observed_change_percent: quote.data.changePercent ?? 0,
        observed_at: observedAt, notification_title: title, notification_message: message,
        input_idempotency_key: idempotencyKey(alert.id, alert.cooldown_minutes, now),
      });
      if (triggerError) throw triggerError;
      empty.evaluated += 1; if (notificationId) empty.triggered += 1;
    }

    const push = await deliverPendingPushes(client, 50, now);
    empty.pushSent = push.sent; empty.pushFailed = push.failed; empty.pushDeferred = push.deferred; empty.subscriptionsCleaned = push.cleaned;
    const status = empty.unavailable || empty.pushFailed ? 'partial' : 'completed';
    await client.from('alert_evaluation_runs').update({ status, evaluated_count: empty.evaluated, triggered_count: empty.triggered,
      unavailable_count: empty.unavailable, push_sent_count: empty.pushSent, push_failed_count: empty.pushFailed,
      completed_at: new Date().toISOString() }).eq('id', run.id);
    console.info('background-alerts', { status, evaluated: empty.evaluated, triggered: empty.triggered, unavailable: empty.unavailable, pushSent: empty.pushSent, pushFailed: empty.pushFailed });
    return empty;
  } catch (cause) {
    const code = cause instanceof MarketDataError ? cause.code : 'run-failed';
    await client.from('alert_evaluation_runs').update({ status: 'failed', error_code: code, completed_at: new Date().toISOString() }).eq('id', run.id);
    console.error('background-alerts', { status: 'failed', code });
    throw cause;
  }
}
