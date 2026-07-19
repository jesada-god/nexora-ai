import type { CompanyProfile } from '@/src/lib/market-data/types';

interface IdentitySource {
  name?: string | null;
  exchange?: string | null;
  symbol?: string | null;
}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveCompanyIdentity(input: {
  symbol: string;
  profile: CompanyProfile | null;
  instrument: IdentitySource | null;
  quoteMetadata: IdentitySource | null;
}): { name: string; exchange: string | null } {
  const symbol = text(input.symbol) ?? input.symbol;
  return {
    name: text(input.profile?.name)
      ?? text(input.instrument?.name)
      ?? text(input.quoteMetadata?.name)
      ?? text(input.quoteMetadata?.symbol)
      ?? symbol,
    exchange: text(input.profile?.exchange)
      ?? text(input.instrument?.exchange)
      ?? text(input.quoteMetadata?.exchange),
  };
}
