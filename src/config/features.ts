export function featureFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export function technicalIndicatorsEnabled() {
  return featureFlagEnabled(process.env.FEATURE_TECHNICAL_INDICATORS);
}

