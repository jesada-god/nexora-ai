'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';
import { OptionPositionRepository } from '@/src/lib/portfolio/options/repository';
import { optionPositionSchema } from '@/src/lib/portfolio/options/validation';
import type { PortfolioActionResult } from './actions';
import { getInstrumentStatus } from '@/src/lib/instruments/status';

async function repository() {
  const client = await createClient(); if (!client) return null;
  const { data: { user } } = await client.auth.getUser(); return user ? new OptionPositionRepository(client) : null;
}
function invalid(message: string, fields?: Record<string, string>): PortfolioActionResult { return { ok: false, code: 'invalid', message, fields }; }
function failure(error: unknown): PortfolioActionResult {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  return code === '42501' ? { ok: false, code: 'unauthorized', message: 'คุณไม่มีสิทธิ์แก้ไขสัญญานี้' } : { ok: false, code: 'database', message: 'บันทึกสัญญาไม่สำเร็จ กรุณาลองอีกครั้ง' };
}
function parse(raw: unknown) {
  const result = optionPositionSchema.safeParse(raw); if (result.success) return result.data;
  const fields: Record<string, string> = {}; for (const issue of result.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return invalid('กรุณาตรวจสอบข้อมูลสัญญา', fields);
}
const uuid = z.string().uuid();

export async function createOptionPositionAction(raw: unknown): Promise<PortfolioActionResult> {
  const input = parse(raw); if ('ok' in input) return input; if (input.status === 'closed') return invalid('สัญญาใหม่ต้องเป็น Open หรือ Cancelled'); const repo = await repository(); if (!repo) return invalid('กรุณาเข้าสู่ระบบอีกครั้ง');
  try {
    const client = await createClient();
    if (client && await getInstrumentStatus(client, input.underlyingSymbol) === 'delisted') return { ok: false, code: 'delisted', message: 'ไม่สามารถเพิ่มออปชันใหม่ของหุ้นที่ delisted ได้' };
    await repo.create(input); revalidatePath('/portfolio'); return { ok: true };
  } catch (error) { return failure(error); }
}
export async function updateOptionPositionAction(id: string, raw: unknown): Promise<PortfolioActionResult> {
  if (!uuid.safeParse(id).success) return invalid('ไม่พบสัญญา'); const input = parse(raw); if ('ok' in input) return input;
  const repo = await repository(); if (!repo) return invalid('กรุณาเข้าสู่ระบบอีกครั้ง');
  try { await repo.update(id, input); revalidatePath('/portfolio'); return { ok: true }; } catch (error) { return failure(error); }
}
export async function closeOptionPositionAction(id: string, closedAt: string): Promise<PortfolioActionResult> {
  if (!uuid.safeParse(id).success || !z.string().date().safeParse(closedAt).success || closedAt > new Date().toISOString().slice(0, 10)) return invalid('วันที่ปิดสัญญาไม่ถูกต้อง');
  const repo = await repository(); if (!repo) return invalid('กรุณาเข้าสู่ระบบอีกครั้ง');
  try { await repo.close(id, closedAt); revalidatePath('/portfolio'); return { ok: true }; } catch (error) { return failure(error); }
}
export async function deleteOptionPositionAction(id: string): Promise<PortfolioActionResult> {
  if (!uuid.safeParse(id).success) return invalid('ไม่พบสัญญา'); const repo = await repository(); if (!repo) return invalid('กรุณาเข้าสู่ระบบอีกครั้ง');
  try { await repo.delete(id); revalidatePath('/portfolio'); return { ok: true }; } catch (error) { return failure(error); }
}
