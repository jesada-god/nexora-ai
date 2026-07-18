import type { InstrumentSnapshot } from './providers.ts';
import type { InstrumentSyncCounts, MarketInstrumentInput } from './types.ts';

export interface InstrumentSyncOperations {
  preview(rows: MarketInstrumentInput[], failed: number): Promise<InstrumentSyncCounts>;
  persist(rows: MarketInstrumentInput[], failed: number): Promise<InstrumentSyncCounts>;
}

export interface InstrumentSyncExecution {
  counts: InstrumentSyncCounts;
  wroteDatabase: boolean;
}

export async function executeInstrumentSync(
  snapshot: InstrumentSnapshot,
  dryRun: boolean,
  operations: InstrumentSyncOperations,
): Promise<InstrumentSyncExecution> {
  if (snapshot.incomplete) {
    return { counts: { inserted: 0, updated: 0, skipped: 0, failed: snapshot.failures.length }, wroteDatabase: false };
  }
  const counts = dryRun
    ? await operations.preview(snapshot.instruments, snapshot.failed)
    : await operations.persist(snapshot.instruments, snapshot.failed);
  return { counts, wroteDatabase: !dryRun };
}
