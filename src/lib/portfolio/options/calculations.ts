import type { OptionPosition, OptionStatus } from './types';
import { fixedToNumber } from '../../money/fixed';

const MONEY_SCALE = 100_000_000n;

function scaled(value: string): bigint {
  const match = value.match(/^(\d+)(?:\.(\d{0,8}))?$/);
  if (!match) throw new Error('Invalid option decimal');
  return BigInt(match[1]) * MONEY_SCALE + BigInt((match[2] ?? '').padEnd(8, '0'));
}

export function calculateOptionTotalCost(premiumPerShare: string, contracts: string): number {
  const premium = scaled(premiumPerShare);
  const count = BigInt(contracts);
  return Number(premium * count * 100n) / Number(MONEY_SCALE);
}

export function calculateOpenOptionsMarketValue(positions: OptionPosition[], today?: string): number {
  const total = positions.reduce((sum, position) => {
    if (calculateOptionStatus(position, today) !== 'open') return sum;
    return sum + scaled(position.premiumPerShare) * BigInt(position.contracts) * 100n;
  }, 0n);
  return fixedToNumber(total);
}

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function calculateDte(expirationDate: string, today = new Date().toISOString().slice(0, 10)): number {
  return Math.ceil((utcDay(expirationDate) - utcDay(today)) / 86_400_000);
}

export function calculateOptionStatus(position: Pick<OptionPosition, 'status' | 'expirationDate'>, today?: string): OptionStatus {
  if (position.status !== 'open') return position.status;
  return calculateDte(position.expirationDate, today) < 0 ? 'expired' : 'open';
}
