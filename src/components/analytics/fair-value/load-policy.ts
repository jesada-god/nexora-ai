export function canLoadFairValue(featureEnabled: boolean, sectionOpen: boolean, analyzeRequested: boolean, loading: boolean) {
  return featureEnabled && sectionOpen && analyzeRequested && !loading;
}

/** Layer visibility is local presentation state and intentionally performs no I/O. */
export function toggleFairValueLayer(current: boolean) { return !current; }
