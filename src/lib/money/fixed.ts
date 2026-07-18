const SCALE_DIGITS = 8;
const SCALE = 100_000_000n;

export type Fixed = bigint;

export function fixed(value: string | number | bigint | null | undefined): Fixed {
  if (value == null || value === '') return 0n;
  if (typeof value === 'bigint') return value;
  const source = typeof value === 'number' ? value.toFixed(SCALE_DIGITS) : value.trim();
  const match = source.match(/^(-?)(\d+)(?:\.(\d{0,8}))?$/);
  if (!match) throw new Error(`Invalid fixed-point decimal: ${String(value)}`);
  const magnitude = BigInt(match[2]) * SCALE + BigInt((match[3] ?? '').padEnd(SCALE_DIGITS, '0'));
  return match[1] === '-' ? -magnitude : magnitude;
}

export function fixedMultiply(left: Fixed, right: Fixed): Fixed {
  const product = left * right;
  const adjustment = product >= 0n ? SCALE / 2n : -(SCALE / 2n);
  return (product + adjustment) / SCALE;
}

export function fixedDivide(left: Fixed, right: Fixed): Fixed {
  if (right === 0n) return 0n;
  const numerator = left * SCALE;
  const adjustment = (numerator >= 0n) === (right >= 0n) ? right / 2n : -(right / 2n);
  return (numerator + adjustment) / right;
}

export function fixedToNumber(value: Fixed): number {
  return Number(value) / Number(SCALE);
}

export function fixedToString(value: Fixed): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = String(magnitude % SCALE).padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function fixedPercent(value: Fixed, basis: Fixed): Fixed {
  return basis === 0n ? 0n : fixedDivide(fixedMultiply(value, fixed('100')), basis);
}
