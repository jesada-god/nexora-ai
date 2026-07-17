import Link from 'next/link';
import { AuthCard } from '@/src/components/auth/AuthCard';
import { AuthMessage } from '@/src/components/auth/AuthMessage';
import { ConfigurationRequired } from '@/src/components/auth/ConfigurationRequired';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { isSupabaseConfigured } from '@/src/config/env/client';
import { forgotPasswordAction } from '../actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;
  return (
    <AuthCard title="ลืมรหัสผ่าน" description="เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณ">
      {!isSupabaseConfigured ? <ConfigurationRequired /> : (
        <><AuthMessage error={error} /><form action={forgotPasswordAction} className="space-y-4"><div><label htmlFor="email" className="mb-1.5 block text-sm text-slate-300">อีเมล</label><Input id="email" name="email" type="email" autoComplete="email" required /></div><Button type="submit" size="lg" className="w-full">ส่งลิงก์รีเซ็ต</Button></form><Link href="/auth/sign-in" className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm text-[#D4FF00]">กลับหน้าเข้าสู่ระบบ</Link></>
      )}
    </AuthCard>
  );
}
