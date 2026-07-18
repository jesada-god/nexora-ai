import 'server-only';

import type { MarketDataProvider } from '@/src/lib/market-data/types';
import { conditionMatches, cooldownElapsed, describeCondition } from './logic';
import { AlertsRepository } from './repository';

export interface EvaluationSummary { evaluated: number; triggered: number; unavailable: string[] }

export async function evaluateEnabledAlerts(repo: AlertsRepository, provider: MarketDataProvider, now = new Date()): Promise<EvaluationSummary> {
  const alerts = (await repo.list()).filter((alert) => alert.enabled);
  const summary: EvaluationSummary = { evaluated: 0, triggered: 0, unavailable: [] };
  const quotes = new Map<string, Awaited<ReturnType<MarketDataProvider['getQuote']>> | null>();

  await Promise.all([...new Set(alerts.map((alert) => alert.symbol))].map(async (symbol) => {
    try { quotes.set(symbol, await provider.getQuote(symbol)); } catch { quotes.set(symbol, null); summary.unavailable.push(symbol); }
  }));

  for (const alert of alerts) {
    const result = quotes.get(alert.symbol);
    if (!result) continue;
    const observedAt = now.toISOString();
    await repo.markEvaluated(alert.id, observedAt);
    summary.evaluated += 1;
    if (!conditionMatches(alert, result.data) || !cooldownElapsed(alert.lastTriggeredAt, alert.cooldownMinutes, now)) continue;
    const condition = describeCondition(alert.condition, alert.targetValue);
    const notificationId = await repo.trigger(alert.id, result.data.price, result.data.changePercent, observedAt,
      `${alert.symbol} ตรงตาม Price Alert`, `${condition} — ราคาที่ตรวจพบ ${result.data.price.toLocaleString()}${result.data.changePercent == null ? '' : ` (${result.data.changePercent.toFixed(2)}%)`}`);
    if (notificationId) summary.triggered += 1;
  }
  return summary;
}
