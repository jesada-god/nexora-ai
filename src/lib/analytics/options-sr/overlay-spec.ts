import type { BandSpec, LineSpec } from '@/src/lib/analytics/institutional-sr/overlay-spec';
import type { OptionsLevel, OptionsSrResult } from './types';

/**
 * Neutral, renderer-agnostic overlay lines for Options-Driven S/R. These are
 * kept entirely separate from the D1 zone geometry (item 18): they are appended
 * to the shared overlay spec as their own lines, so toggling expirations repaints
 * only these lines and never rebuilds a zone. The transform is pure so labels,
 * colours and geometry stay unit-testable without a canvas.
 */

// Call Wall red, Put Wall green, Max Pain neutral/dashed (item 17).
const CALL_WALL_COLOR = '#fb7185';
const PUT_WALL_COLOR = '#34d399';
const MAX_PAIN_COLOR = '#cbd5e1';

const RELIABILITY_TAG = { high: 'high', moderate: 'moderate', low: 'low' } as const;

/** Compact "MM-DD" tag so the expiration is visible without overflowing the label. */
function expirationTag(expiration: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(expiration) ? expiration.slice(5) : expiration;
}

function levelLine(id: string, name: string, level: OptionsLevel, color: string, dashed: boolean): LineSpec {
  return {
    id,
    price: level.price,
    color,
    label: `${name} ${level.price} · ${expirationTag(level.expiration)} · ${RELIABILITY_TAG[level.reliability]}`,
    dashed,
  };
}

export interface OptionsSrOverlay {
  lines: LineSpec[];
  bands: BandSpec[];
}

/**
 * Build the Options S/R overlay lines. Returns empty when disabled or when the
 * computation is unavailable, so a failure isolates to no lines rather than
 * breaking the shared spec (item 19).
 */
export function buildOptionsSrOverlay(result: OptionsSrResult | undefined | null, show: boolean): OptionsSrOverlay {
  if (!show || !result || result.status !== 'available') return { lines: [], bands: [] };
  const lines: LineSpec[] = [];
  if (result.callWall) lines.push(levelLine('options-call-wall', 'Call Wall', result.callWall, CALL_WALL_COLOR, false));
  if (result.putWall) lines.push(levelLine('options-put-wall', 'Put Wall', result.putWall, PUT_WALL_COLOR, false));
  if (result.maxPain) lines.push(levelLine('options-max-pain', 'Max Pain', result.maxPain, MAX_PAIN_COLOR, true));
  return { lines, bands: [] };
}
