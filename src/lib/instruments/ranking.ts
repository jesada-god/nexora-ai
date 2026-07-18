import type { InstrumentAssetType, InstrumentStatus } from './types';

export interface RankableInstrument {
  symbol: string; name: string; assetType: InstrumentAssetType; status: InstrumentStatus;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value.toLowerCase()} `;
  return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) => padded.slice(index, index + 3)));
}

function similarity(left: string, right: string): number {
  const a = trigrams(left); const b = trigrams(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  return a.size + b.size ? (2 * intersection) / (a.size + b.size) : 0;
}

export function rankInstrumentCandidates<T extends RankableInstrument>(rows: T[], rawQuery: string, options: { assetType?: InstrumentAssetType; includeDelisted?: boolean } = {}): T[] {
  const query = rawQuery.trim().toLowerCase();
  return rows.filter((row) => (options.includeDelisted || row.status === 'active') && (!options.assetType || row.assetType === options.assetType))
    .map((row) => {
      const symbol = row.symbol.toLowerCase(); const name = row.name.toLowerCase();
      const bucket = symbol === query ? 0 : symbol.startsWith(query) ? 1 : name.startsWith(query) ? 2 : 3;
      return { row, bucket, score: similarity(`${symbol} ${name}`, query) };
    })
    .filter((item) => item.bucket < 3 || item.score > 0)
    .sort((left, right) => left.bucket - right.bucket || right.score - left.score || left.row.symbol.localeCompare(right.row.symbol))
    .map((item) => item.row);
}

