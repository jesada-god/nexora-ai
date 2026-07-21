import { classifySide, distancePercent, priceDistance } from './distance';
import { mergeConfluence } from './dedup';
import { estimateEta } from './eta';
import { orderAndCap } from './ordering';
import { evaluateProximity } from './proximity';
import type {
  BuildDecisionPanelInput,
  DecisionPanelItem,
  DecisionPanelModel,
  DecisionSide,
  NormalizedReference,
} from './types';

/**
 * Assemble the decision-panel model from pre-normalised references and the single
 * accepted price. Pure and deterministic: projection (side + distance), confluence
 * merging, ordering/capping, per-item ETA and proximity all derive from the
 * inputs, so a price tick reprojects everything without any market refetch.
 */

const DEFAULT_MAX_PER_SIDE = 3;

function toBadge(reference: NormalizedReference) {
  return {
    sourceType: reference.sourceType,
    sourceLabel: reference.sourceLabel,
    reliability: reference.reliability,
    strength: reference.strength,
    score: reference.score,
  };
}

function project(reference: NormalizedReference, acceptedPrice: number, eta: BuildDecisionPanelInput['eta']): DecisionPanelItem {
  const side = classifySide(reference.priceLow, reference.priceHigh, reference.midpoint, acceptedPrice);
  return {
    ...reference,
    side,
    distancePercent: distancePercent(reference.midpoint, acceptedPrice),
    confluence: [toBadge(reference)],
    eta: estimateEta({
      priceDistance: priceDistance(reference.midpoint, acceptedPrice),
      acceptedPrice,
      eta,
    }),
  };
}

export function buildDecisionPanelModel(input: BuildDecisionPanelInput): DecisionPanelModel {
  const {
    references,
    acceptedPrice,
    anchor,
    atrTolerance,
    eta,
    proximityThresholdPercent = 3,
    previousAlertSignature = null,
    maxPerSide = DEFAULT_MAX_PER_SIDE,
    options,
  } = input;

  const technicalAvailable = references.some((reference) => reference.sourceType !== 'call-wall' && reference.sourceType !== 'put-wall' && reference.sourceType !== 'max-pain');

  // Without a usable accepted price there is nothing to project against.
  if (acceptedPrice == null || !Number.isFinite(acceptedPrice) || acceptedPrice <= 0) {
    return {
      anchor,
      resistance: [], support: [], neutral: [],
      extraResistance: [], extraSupport: [], extraNeutral: [],
      alert: { status: 'inactive', thresholdPercent: proximityThresholdPercent, item: null, signature: null, isNew: false },
      options,
      technicalAvailable,
    };
  }

  const projected = references.map((reference) => project(reference, acceptedPrice, eta));

  const bySide: Record<DecisionSide, DecisionPanelItem[]> = { resistance: [], support: [], neutral: [] };
  for (const item of projected) bySide[item.side].push(item);

  // Merge visually duplicate references within the ATR tolerance, per side.
  const mergedResistance = mergeConfluence(bySide.resistance, atrTolerance);
  const mergedSupport = mergeConfluence(bySide.support, atrTolerance);
  const mergedNeutral = mergeConfluence(bySide.neutral, atrTolerance);

  const resistance = orderAndCap(mergedResistance, maxPerSide);
  const support = orderAndCap(mergedSupport, maxPerSide);
  const neutral = orderAndCap(mergedNeutral, maxPerSide);

  // Proximity considers every merged reference (primary + extra), not just the top cards.
  const allMerged = [...mergedResistance, ...mergedSupport, ...mergedNeutral];
  const alert = evaluateProximity(allMerged, anchor, proximityThresholdPercent, previousAlertSignature);

  return {
    anchor,
    resistance: resistance.primary,
    support: support.primary,
    neutral: neutral.primary,
    extraResistance: resistance.extra,
    extraSupport: support.extra,
    extraNeutral: neutral.extra,
    alert,
    options,
    technicalAvailable,
  };
}
