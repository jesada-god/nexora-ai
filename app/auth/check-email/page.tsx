import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { AuthCard } from '@/src/components/auth/AuthCard';

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const email = typeof params.email === 'string' ? params.email : 'อีเมลของคุณ';
  const isReset = params.reset === '1';
  return (
    <AuthCard title="ตรวจสอบอีเมล" description={isReset ? 'หากอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว' : 'ส่งลิงก์ยืนยันการสมัครแล้ว'}>
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center"><MailCheck aria-hidden="true" className="mx-auto text-emerald-400" size={32} /><p className="mt-3 break-all text-sm text-emerald-100">{email}</p></div>
      <Link href="/auth/sign-in" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-700 text-sm font-semibold text-white">กลับหน้าเข้าสู่ระบบ</Link>
    </AuthCard>
  );
}
