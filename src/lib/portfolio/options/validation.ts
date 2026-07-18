import { z } from 'zod';
import type { OptionInput } from './types';

const decimal = z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/, 'กรอกทศนิยมไม่เกิน 8 ตำแหน่ง');
const positive = decimal.refine((value) => Number(value) > 0, 'ค่าต้องมากกว่า 0');
const optionalSigned = z.string().trim().refine((value) => value === '' || /^-?\d+(?:\.\d{1,8})?$/.test(value), 'รูปแบบตัวเลขไม่ถูกต้อง');

export const optionPositionSchema = z.object({
  underlyingSymbol: z.string().trim().toUpperCase().regex(/^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]{0,19})$/, 'Symbol ไม่ถูกต้อง'),
  optionKind: z.enum(['call', 'put']),
  contracts: z.string().trim().regex(/^\d+$/, 'จำนวนสัญญาต้องเป็นจำนวนเต็ม').refine((value) => Number(value) > 0 && Number(value) <= 1_000_000, 'จำนวนสัญญาไม่ถูกต้อง'),
  premiumPerShare: positive,
  strikePrice: positive,
  openedAt: z.string().date('วันเปิดสัญญาไม่ถูกต้อง').refine((value) => value <= new Date().toISOString().slice(0, 10), 'วันเปิดสัญญาต้องไม่อยู่ในอนาคต'),
  expirationDate: z.string().date('วันหมดอายุไม่ถูกต้อง'),
  impliedVolatility: optionalSigned.refine((value) => value === '' || (Number(value) >= 0 && Number(value) <= 1000), 'IV ต้องอยู่ระหว่าง 0–1000'),
  delta: optionalSigned.refine((value) => value === '' || Math.abs(Number(value)) <= 1, 'Delta ต้องอยู่ระหว่าง -1 ถึง 1'),
  theta: optionalSigned,
  note: z.string().trim().max(500, 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร'),
  status: z.enum(['open', 'closed', 'cancelled']),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.expirationDate < value.openedAt) context.addIssue({ code: 'custom', path: ['expirationDate'], message: 'วันหมดอายุต้องไม่ก่อนวันเปิดสัญญา' });
});

export function parseOptionInput(raw: unknown): OptionInput {
  return optionPositionSchema.parse(raw);
}
