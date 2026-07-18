'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';
import { NotificationsRepository } from '@/src/lib/alerts/repository';

type Result = { ok: true; changed: number } | { ok: false; message: string };
async function repo() {
  const client = await createClient(); if (!client) return null;
  const { data: { user } } = await client.auth.getUser();
  return user ? new NotificationsRepository(client, user.id) : null;
}

export async function markNotificationReadAction(rawId: string): Promise<Result> {
  const id = z.uuid().safeParse(rawId); const repository = await repo();
  if (!id.success || !repository) return { ok: false, message: 'ไม่สามารถทำรายการได้' };
  try { const changed = await repository.markRead(id.data); revalidatePath('/notifications'); return { ok: true, changed: changed ? 1 : 0 }; }
  catch { return { ok: false, message: 'บันทึกสถานะอ่านไม่สำเร็จ' }; }
}

export async function markAllNotificationsReadAction(): Promise<Result> {
  const repository = await repo(); if (!repository) return { ok: false, message: 'กรุณาเข้าสู่ระบบอีกครั้ง' };
  try { const changed = await repository.markAllRead(); revalidatePath('/notifications'); return { ok: true, changed }; }
  catch { return { ok: false, message: 'บันทึกสถานะอ่านไม่สำเร็จ' }; }
}

