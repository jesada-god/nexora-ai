/**
 * Independent, locally-persisted toggle for the Options-Driven S/R overlay.
 * Deliberately separate from the institutional overlay toggles (Zones, Volume
 * Profile, AVWAP) so enabling it is orthogonal (item 14). Unlike those pure
 * overlays, enabling this one *does* lazily trigger a data load (item 15); the
 * toggle state itself is the only thing persisted here.
 */
export interface OptionsSrToggle {
  enabled: boolean;
}

export const OPTIONS_SR_STORAGE_KEY = 'nexora:options-sr:v1';

export const DEFAULT_OPTIONS_SR_TOGGLE: OptionsSrToggle = { enabled: false };

export function parseOptionsSrToggle(value: string | null): OptionsSrToggle {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_OPTIONS_SR_TOGGLE };
    const candidate = parsed as Record<string, unknown>;
    return { enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_OPTIONS_SR_TOGGLE.enabled };
  } catch {
    return { ...DEFAULT_OPTIONS_SR_TOGGLE };
  }
}

export function readOptionsSrToggle(storage: Storage | undefined): OptionsSrToggle {
  if (!storage) return { ...DEFAULT_OPTIONS_SR_TOGGLE };
  try {
    return parseOptionsSrToggle(storage.getItem(OPTIONS_SR_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_OPTIONS_SR_TOGGLE };
  }
}

export function writeOptionsSrToggle(storage: Storage | undefined, toggle: OptionsSrToggle): void {
  if (!storage) return;
  try {
    storage.setItem(OPTIONS_SR_STORAGE_KEY, JSON.stringify(toggle));
  } catch {
    /* ignore persistence failures */
  }
}
