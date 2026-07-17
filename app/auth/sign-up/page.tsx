import Link from 'next/link';
import { AuthCard } from '@/src/components/auth/AuthCard';
import { AuthMessage } from '@/src/components/auth/AuthMessage';
import { ConfigurationRequired } from '@/src/components/auth/ConfigurationRequired';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { isSupabaseConfigured } from '@/src/config/env/client';
import { getSafeReturnPath } from '@/src/lib/auth/paths';
import { signUpAction } from '../actions';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = getSafeReturnPath(typeof params.next === 'string' ? params.next : null);
  const error = typeof params.error === 'string' ? params.error : undefined;
  return (
    <AuthCard title="สร้างบัญชี" description="ข้อมูลบัญชีแยกจากผู้ใช้อื่นด้วย Row Level Security">
      {!isSupabaseConfigured ? <ConfigurationRequired /> : (
        <>
          <AuthMessage error={error} />
          <form action={signUpAction} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div><label htmlFor="fullName" className="mb-1.5 block text-sm text-slate-300">ชื่อที่แสดง</label><Input id="fullName" name="fullName" autoComplete="name" maxLength={100} required /></div>
            <div><label htmlFor="email" className="mb-1.5 block text-sm text-slate-300">อีเมล</label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
            <div><label htmlFor="password" className="mb-1.5 block text-sm text-slate-300">รหัสผ่าน</label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /><p className="mt-1 text-xs text-slate-500">อย่างน้อย 8 ตัวอักษร</p></div>
            <Button type="submit" size="lg" className="w-full">สมัครสมาชิก</Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-400">มีบัญชีแล้ว? <Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-[#D4FF00]">เข้าสู่ระบบ</Link></p>
        </>
      )}
    </AuthCard>
  );
}
