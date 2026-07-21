/**
 * Independent, locally-persisted toggles for the institutional overlays.
 * Toggling a layer never triggers a market request — it only shows/hides an
 * overlay computed from already-loaded candles.
 */
export interface InstitutionalOverlayToggles {
  zones: boolean;
  volumeProfile: boolean;
  anchoredVwap: boolean;
}

export const OVERLAY_TOGGLES_STORAGE_KEY = 'nexora:institutional-overlays:v1';

export const DEFAULT_OVERLAY_TOGGLES: InstitutionalOverlayToggles = {
  zones: true,
  volumeProfile: false,
  anchoredVwap: false,
};

export function serializeOverlayToggles(toggles: InstitutionalOverlayToggles): string {
  return JSON.stringify(toggles);
}

export function parseOverlayToggles(value: string | null): InstitutionalOverlayToggles {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_OVERLAY_TOGGLES };
    const candidate = parsed as Record<string, unknown>;
    return {
      zones: typeof candidate.zones === 'boolean' ? candidate.zones : DEFAULT_OVERLAY_TOGGLES.zones,
      volumeProfile: typeof candidate.volumeProfile === 'boolean' ? candidate.volumeProfile : DEFAULT_OVERLAY_TOGGLES.volumeProfile,
      anchoredVwap: typeof candidate.anchoredVwap === 'boolean' ? candidate.anchoredVwap : DEFAULT_OVERLAY_TOGGLES.anchoredVwap,
    };
  } catch {
    return { ...DEFAULT_OVERLAY_TOGGLES };
  }
}

export function readOverlayToggles(storage: Storage | undefined): InstitutionalOverlayToggles {
  if (!storage) return { ...DEFAULT_OVERLAY_TOGGLES };
  try {
    return parseOverlayToggles(storage.getItem(OVERLAY_TOGGLES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_OVERLAY_TOGGLES };
  }
}

export function writeOverlayToggles(storage: Storage | undefined, toggles: InstitutionalOverlayToggles): void {
  if (!storage) return;
  try {
    storage.setItem(OVERLAY_TOGGLES_STORAGE_KEY, serializeOverlayToggles(toggles));
  } catch {
    /* ignore persistence failures */
  }
}
