import { AuthCard } from '@/src/components/auth/AuthCard';
import { AuthMessage } from '@/src/components/auth/AuthMessage';
import { ConfigurationRequired } from '@/src/components/auth/ConfigurationRequired';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { isSupabaseConfigured } from '@/src/config/env/client';
import { resetPasswordAction } from '../actions';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : undefined;
  return (
    <AuthCard title="ตั้งรหัสผ่านใหม่" description="ตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษรสำหรับบัญชีของคุณ">
      {!isSupabaseConfigured ? <ConfigurationRequired /> : (
        <><AuthMessage error={error} /><form action={resetPasswordAction} className="space-y-4"><div><label htmlFor="password" className="mb-1.5 block text-sm text-slate-300">รหัสผ่านใหม่</label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /></div><Button type="submit" size="lg" className="w-full">บันทึกรหัสผ่านใหม่</Button></form></>
      )}
    </AuthCard>
  );
}
