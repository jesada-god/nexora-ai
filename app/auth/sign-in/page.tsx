import Link from 'next/link';
import { AuthCard } from '@/src/components/auth/AuthCard';
import { AuthMessage } from '@/src/components/auth/AuthMessage';
import { ConfigurationRequired } from '@/src/components/auth/ConfigurationRequired';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { isSupabaseConfigured } from '@/src/config/env/client';
import { getSafeReturnPath } from '@/src/lib/auth/paths';
import { signInAction } from '../actions';

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = getSafeReturnPath(typeof params.next === 'string' ? params.next : null);
  const error = typeof params.error === 'string' ? params.error : undefined;
  const message = typeof params.message === 'string' ? params.message : undefined;
  const expired = params.reason === 'session_expired';

  return (
    <AuthCard title="เข้าสู่ระบบ" description="เข้าสู่ระบบเพื่อเปิดพอร์ตจำลอง Watchlist Alerts และการตั้งค่าของคุณ">
      {!isSupabaseConfigured ? <ConfigurationRequired /> : (
        <>
          <AuthMessage error={error ?? (expired ? 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' : undefined)} message={message} />
          <form action={signInAction} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <div><label htmlFor="email" className="mb-1.5 block text-sm text-slate-300">อีเมล</label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
            <div><div className="mb-1.5 flex items-center justify-between"><label htmlFor="password" className="text-sm text-slate-300">รหัสผ่าน</label><Link href="/auth/forgot-password" className="text-xs text-[#D4FF00]">ลืมรหัสผ่าน?</Link></div><Input id="password" name="password" type="password" autoComplete="current-password" minLength={8} required /></div>
            <Button type="submit" size="lg" className="w-full">เข้าสู่ระบบ</Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-400">ยังไม่มีบัญชี? <Link href={`/auth/sign-up?next=${encodeURIComponent(next)}`} className="font-semibold text-[#D4FF00]">สมัครสมาชิก</Link></p>
        </>
      )}
    </AuthCard>
  );
}
