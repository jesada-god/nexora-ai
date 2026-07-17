import Link from 'next/link';
import { DatabaseZap } from 'lucide-react';

export function ConfigurationRequired() {
  return (
    <div role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
      <div className="flex items-start gap-3">
        <DatabaseZap aria-hidden="true" className="mt-0.5 shrink-0 text-amber-300" size={20} />
        <div>
          <p className="font-semibold">ต้องตั้งค่า Supabase ก่อน</p>
          <p className="mt-1 leading-6 text-amber-100/80">
            เพิ่ม `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ใน `.env.local` แล้ว restart dev server
          </p>
        </div>
      </div>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-[#D4FF00]">กลับไปดูหน้าตลาดสาธารณะ</Link>
    </div>
  );
}
