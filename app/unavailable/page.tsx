import Link from 'next/link';
import { CloudOff } from 'lucide-react';

export default function UnavailablePage() {
  return (
    <div className="min-h-[60dvh] p-6 flex flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
        <CloudOff aria-hidden="true" size={24} />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">ข้อมูลยังไม่พร้อมใช้งาน</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">ยังไม่ได้เชื่อมต่อบริการข้อมูลจริง หรือการเชื่อมต่ออาจขัดข้อง</p>
      <Link href="/" className="mt-6 min-h-11 inline-flex items-center rounded-lg bg-[#D4FF00] px-5 text-sm font-semibold text-black">กลับหน้าแรก</Link>
    </div>
  );
}
