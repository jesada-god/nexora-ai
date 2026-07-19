import 'server-only';
import type { OptionAggregate } from './calculations';
export interface OptionsStatisticsProvider { readonly id: string; getOptionAggregates(symbol: string): Promise<{ rows: OptionAggregate[]; asOf: string }>; }
export function getOptionsStatisticsProvider(): OptionsStatisticsProvider | null { return null; }
