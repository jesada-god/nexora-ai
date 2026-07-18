import { z } from 'zod';
import { transactionTypes, type PortfolioTransactionType } from './types';

const positiveDecimal = z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/, 'กรอกเลขทศนิยมไม่เกิน 8 ตำแหน่ง')
  .refine((value) => Number(value) > 0 && Number.isFinite(Number(value)), 'ค่าต้องมากกว่า 0');
const symbol = z.string().trim().toUpperCase().regex(/^(\^[A-Z0-9]+|[A-Z0-9][A-Z0-9.-]{0,19})$/, 'Symbol ไม่ถูกต้อง');

export const portfolioTransactionSchema = z.object({
  type: z.enum(transactionTypes),
  symbol: z.string().optional().default(''),
  quantity: z.string().optional().default(''),
  price: z.string().optional().default(''),
  amount: z.string().optional().default(''),
  originalCurrency: z.enum(['USD', 'THB']).optional().default('USD'),
  fxRateAtTransaction: z.string().optional().default(''),
  occurredAt: z.string().date('วันที่ไม่ถูกต้อง').refine((value) => value <= new Date().toISOString().slice(0, 10), 'วันที่ต้องไม่อยู่ในอนาคต'),
  note: z.string().trim().max(500, 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร').optional().default(''),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  const assetType = value.type === 'acquisition' || value.type === 'disposal';
  const cashType = !assetType;
  if (assetType) {
    for (const [field, result] of [['symbol', symbol.safeParse(value.symbol)], ['quantity', positiveDecimal.safeParse(value.quantity)], ['price', positiveDecimal.safeParse(value.price)]] as const) {
      if (!result.success) context.addIssue({ code: 'custom', path: [field], message: result.error.issues[0].message });
    }
  }
  if (cashType) {
    const result = positiveDecimal.safeParse(value.amount);
    if (!result.success) context.addIssue({ code: 'custom', path: ['amount'], message: result.error.issues[0].message });
    if (value.originalCurrency === 'THB') {
      const rate = positiveDecimal.safeParse(value.fxRateAtTransaction);
      if (!rate.success) context.addIssue({ code: 'custom', path: ['fxRateAtTransaction'], message: 'ต้องระบุ USD/THB ณ วันที่เกิดรายการ' });
    }
  }
});

export interface TransactionInput {
  type: PortfolioTransactionType; symbol?: string; quantity?: string; price?: string;
  amount?: string; originalCurrency: 'USD' | 'THB'; fxRateAtTransaction?: string; occurredAt: string; note?: string; idempotencyKey: string;
}
