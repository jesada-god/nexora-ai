import type { DecisionPanelItem, DecisionReliability, DecisionSourceBadge, DecisionStrength } from './types';

/**
 * Confluence merging. Same-side references whose midpoints fall within an
 * ATR-based price tolerance are visually merged into one card, while every
 * contributing source's badge (and its reliability/strength/score) is preserved
 * so confluence stays visible. The representative (highest-quality) reference
 * keeps its price and distance; the merged band spans the union of the cluster.
 */

const RELIABILITY_RANK: Record<DecisionReliability, number> = { high: 3, moderate: 2, low: 1 };
const STRENGTH_RANK: Record<DecisionStrength, number> = { strong: 3, moderate: 2, weak: 1 };

function reliabilityRank(value: DecisionReliability | null): number {
  return value ? RELIABILITY_RANK[value] : 0;
}
function strengthRank(value: DecisionStrength | null): number {
  return value ? STRENGTH_RANK[value] : 0;
}

/** Resolve the merge tolerance (price band): half the ATR, else 0.2% of price, else null. */
export function resolveDedupTolerance(input: { atrValue: number | null; acceptedPrice: number | null }): number | null {
  const { atrValue, acceptedPrice } = input;
  if (typeof atrValue === 'number' && Number.isFinite(atrValue) && atrValue > 0) return atrValue * 0.5;
  if (typeof acceptedPrice === 'number' && Number.isFinite(acceptedPrice) && acceptedPrice > 0) return acceptedPrice * 0.002;
  return null;
}

function toBadge(item: DecisionPanelItem): DecisionSourceBadge {
  return {
    sourceType: item.sourceType,
    sourceLabel: item.sourceLabel,
    reliability: item.reliability,
    strength: item.strength,
    score: item.score,
  };
}

/** Higher wins: score, then reliability, then strength; ties keep input order. */
function isStronger(candidate: DecisionPanelItem, current: DecisionPanelItem): boolean {
  const candidateScore = candidate.score ?? -1;
  const currentScore = current.score ?? -1;
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  if (reliabilityRank(candidate.reliability) !== reliabilityRank(current.reliability)) {
    return reliabilityRank(candidate.reliability) > reliabilityRank(current.reliability);
  }
  return strengthRank(candidate.strength) > strengthRank(current.strength);
}

function mergeCluster(cluster: DecisionPanelItem[]): DecisionPanelItem {
  const representative = cluster.reduce((best, item) => (isStronger(item, best) ? item : best), cluster[0]);
  const badges: DecisionSourceBadge[] = [];
  const seenBadge = new Set<string>();
  const orderedForBadges = [representative, ...cluster.filter((item) => item !== representative)];
  for (const item of orderedForBadges) {
    const badge = toBadge(item);
    const key = `${badge.sourceType}:${badge.sourceLabel}`;
    if (seenBadge.has(key)) continue;
    seenBadge.add(key);
    badges.push(badge);
  }
  const limitations: string[] = [];
  const seenLimitation = new Set<string>();
  for (const item of orderedForBadges) {
    for (const limitation of item.limitations) {
      if (seenLimitation.has(limitation)) continue;
      seenLimitation.add(limitation);
      limitations.push(limitation);
    }
  }
  return {
    ...representative,
    priceLow: Math.min(...cluster.map((item) => item.priceLow)),
    priceHigh: Math.max(...cluster.map((item) => item.priceHigh)),
    // Merged only when every contributor is stale — a fresh source keeps the card qualified.
    stale: cluster.every((item) => item.stale),
    confluence: badges,
    limitations,
  };
}

/**
 * Merge same-side references within `tolerance` price units. Items must already
 * share a side; the caller groups by side first. A null/non-positive tolerance
 * disables merging (each reference keeps its own single-source badge).
 */
export function mergeConfluence(items: readonly DecisionPanelItem[], tolerance: number | null): DecisionPanelItem[] {
  const withBadges = items.map((item) => ({ ...item, confluence: item.confluence.length ? item.confluence : [toBadge(item)] }));
  if (tolerance == null || !(tolerance > 0) || withBadges.length < 2) return withBadges;

  const sorted = [...withBadges].sort((a, b) => a.midpoint - b.midpoint);
  const clusters: DecisionPanelItem[][] = [];
  for (const item of sorted) {
    const last = clusters.at(-1);
    const previousMid = last?.at(-1)?.midpoint;
    if (last && previousMid !== undefined && Math.abs(item.midpoint - previousMid) <= tolerance) {
      last.push(item);
    } else {
      clusters.push([item]);
    }
  }
  return clusters.map((cluster) => (cluster.length === 1 ? cluster[0] : mergeCluster(cluster)));
}
