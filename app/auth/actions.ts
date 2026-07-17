'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/src/lib/supabase/server';
import { getSafeReturnPath } from '@/src/lib/auth/paths';

const credentialsSchema = z.object({
  email: z.email('กรุณากรอกอีเมลให้ถูกต้อง'),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
});

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100, 'ชื่อต้องไม่เกิน 100 ตัวอักษร'),
});

function authRedirect(path: string, values: Record<string, string | undefined>): never {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value && params.set(key, value));
  redirect(`${path}?${params.toString()}`);
}

function firstIssue(result: z.ZodSafeParseError<unknown>): string {
  return result.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
}

export async function signInAction(formData: FormData): Promise<never> {
  const next = getSafeReturnPath(formData.get('next'));
  const parsed = credentialsSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) authRedirect('/auth/sign-in', { error: firstIssue(parsed), next });

  const supabase = await createClient();
  if (!supabase) authRedirect('/auth/configuration-required', { next });
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) authRedirect('/auth/sign-in', { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', next });
  redirect(next);
}

export async function signUpAction(formData: FormData): Promise<never> {
  const next = getSafeReturnPath(formData.get('next'));
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) authRedirect('/auth/sign-up', { error: firstIssue(parsed), next });

  const supabase = await createClient();
  if (!supabase) authRedirect('/auth/configuration-required', { next });
  const headerStore = await headers();
  const origin = headerStore.get('origin') ?? headerStore.get('x-forwarded-host');
  const emailRedirectTo = origin ? `${origin.startsWith('http') ? origin : `https://${origin}`}/auth/callback?next=${encodeURIComponent(next)}` : undefined;
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName }, emailRedirectTo },
  });
  if (error) authRedirect('/auth/sign-up', { error: 'ไม่สามารถสมัครได้ อีเมลนี้อาจถูกใช้งานแล้ว', next });
  if (data.session) redirect(next);
  authRedirect('/auth/check-email', { email: parsed.data.email });
}

export async function forgotPasswordAction(formData: FormData): Promise<never> {
  const parsed = z.object({ email: z.email('กรุณากรอกอีเมลให้ถูกต้อง') }).safeParse({ email: formData.get('email') });
  if (!parsed.success) authRedirect('/auth/forgot-password', { error: firstIssue(parsed) });

  const supabase = await createClient();
  if (!supabase) authRedirect('/auth/configuration-required', {});
  const headerStore = await headers();
  const origin = headerStore.get('origin') ?? headerStore.get('x-forwarded-host');
  const redirectTo = origin ? `${origin.startsWith('http') ? origin : `https://${origin}`}/auth/callback?next=/auth/reset-password` : undefined;
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo });
  authRedirect('/auth/check-email', { email: parsed.data.email, reset: '1' });
}

export async function resetPasswordAction(formData: FormData): Promise<never> {
  const parsed = z.object({ password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร') }).safeParse({ password: formData.get('password') });
  if (!parsed.success) authRedirect('/auth/reset-password', { error: firstIssue(parsed) });

  const supabase = await createClient();
  if (!supabase) authRedirect('/auth/configuration-required', {});
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) authRedirect('/auth/reset-password', { error: 'ลิงก์หมดอายุ กรุณาขอลิงก์ใหม่' });
  await supabase.auth.signOut();
  authRedirect('/auth/sign-in', { message: 'ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบ' });
}

export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  authRedirect('/auth/sign-in', { message: 'ออกจากระบบแล้ว' });
}

export async function deleteAccountAction(formData: FormData): Promise<never> {
  if (formData.get('confirmation') !== 'DELETE') {
    authRedirect('/profile', { error: 'กรุณาพิมพ์ DELETE เพื่อยืนยัน' });
  }
  const supabase = await createClient();
  if (!supabase) authRedirect('/auth/configuration-required', {});
  const { error } = await supabase.rpc('delete_own_account');
  if (error) authRedirect('/profile', { error: 'ไม่สามารถลบบัญชีได้ กรุณาลองอีกครั้ง' });
  authRedirect('/auth/sign-in', { message: 'ลบบัญชีเรียบร้อยแล้ว' });
}
