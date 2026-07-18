'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';
import { AlertsRepository } from '@/src/lib/alerts/repository';
import type { AlertActionResult } from '@/src/lib/alerts/types';
import { symbolSchema } from '@/src/lib/market-data/validation';
import { getInstrumentStatus } from '@/src/lib/instruments/status';

const alertIdSchema = z.uuid();
const alertInputSchema = z.object({
  symbol: symbolSchema,
  condition: z.enum(['above', 'below', 'percent_change_up', 'percent_change_down']),
  targetValue: z.number().finite().positive().max(1_000_000_000),
  cooldownMinutes: z.number().int().min(1).max(10080),
  enabled: z.boolean(),
});
export type AlertInput = z.infer<typeof alertInputSchema>;

async function context() {
  const client = await createClient();
  if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user ? { client, repo: new AlertsRepository(client, user.id) } : null;
}

function failure(error: unknown): AlertActionResult {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === '42501' || code.startsWith('PGRST')) return { ok: false, code: 'unauthorized', message: 'คุณไม่มีสิทธิ์แก้ไข Price Alert นี้' };
  return { ok: false, code: 'database', message: 'บันทึก Price Alert ไม่สำเร็จ กรุณาลองอีกครั้ง' };
}

export async function createAlertAction(raw: AlertInput): Promise<AlertActionResult> {
  const parsed = alertInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid', message: 'ข้อมูล Price Alert ไม่ถูกต้อง' };
  const ctx = await context();
  if (!ctx) return { ok: false, code: 'unauthorized', message: 'กรุณาเข้าสู่ระบบอีกครั้ง' };
  try {
    if (await getInstrumentStatus(ctx.client, parsed.data.symbol) === 'delisted') return { ok: false, code: 'delisted', message: 'ไม่สามารถสร้าง Alert ใหม่สำหรับ Symbol ที่ delisted' };
    const alert = await ctx.repo.create(parsed.data);
    revalidatePath('/alerts');
    return { ok: true, alert };
  } catch (error) { return failure(error); }
}

export async function updateAlertAction(rawId: string, raw: AlertInput): Promise<AlertActionResult> {
  const id = alertIdSchema.safeParse(rawId); const input = alertInputSchema.safeParse(raw);
  if (!id.success || !input.success) return { ok: false, code: 'invalid', message: 'ข้อมูล Price Alert ไม่ถูกต้อง' };
  const ctx = await context();
  if (!ctx) return { ok: false, code: 'unauthorized', message: 'กรุณาเข้าสู่ระบบอีกครั้ง' };
  try {
    const alert = await ctx.repo.update(id.data, input.data);
    if (!alert) return { ok: false, code: 'not-found', message: 'ไม่พบ Price Alert หรือคุณไม่มีสิทธิ์แก้ไข' };
    revalidatePath('/alerts'); return { ok: true, alert };
  } catch (error) { return failure(error); }
}

export async function setAlertEnabledAction(rawId: string, enabled: boolean): Promise<AlertActionResult> {
  const id = alertIdSchema.safeParse(rawId);
  if (!id.success || typeof enabled !== 'boolean') return { ok: false, code: 'invalid', message: 'ข้อมูลไม่ถูกต้อง' };
  const ctx = await context(); if (!ctx) return { ok: false, code: 'unauthorized', message: 'กรุณาเข้าสู่ระบบอีกครั้ง' };
  try { const changed = await ctx.repo.setEnabled(id.data, enabled); if (!changed) return { ok: false, code: 'not-found', message: 'ไม่พบ Price Alert' };
    revalidatePath('/alerts'); return { ok: true }; } catch (error) { return failure(error); }
}

export async function deleteAlertAction(rawId: string): Promise<AlertActionResult> {
  const id = alertIdSchema.safeParse(rawId);
  if (!id.success) return { ok: false, code: 'invalid', message: 'ข้อมูลไม่ถูกต้อง' };
  const ctx = await context(); if (!ctx) return { ok: false, code: 'unauthorized', message: 'กรุณาเข้าสู่ระบบอีกครั้ง' };
  try { const removed = await ctx.repo.remove(id.data); if (!removed) return { ok: false, code: 'not-found', message: 'ไม่พบ Price Alert' };
    revalidatePath('/alerts'); return { ok: true }; } catch (error) { return failure(error); }
}

