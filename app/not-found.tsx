import Link from 'next/link';
import { appConfig } from '@/src/config/app';

export default function NotFound() {
  return (
    <div className="min-h-[60dvh] p-6 flex flex-col items-center justify-center text-center">
      <p className="text-[#D4FF00] font-semibold">{appConfig.name}</p>
      <h1 className="mt-2 text-3xl font-bold text-white">ไม่พบหน้าที่ต้องการ</h1>
      <p className="mt-3 text-slate-400">ลิงก์นี้อาจถูกย้ายหรือไม่มีอยู่แล้ว</p>
      <Link href="/" className="mt-6 min-h-11 inline-flex items-center rounded-lg bg-[#D4FF00] px-5 text-sm font-semibold text-black">กลับหน้าแรก</Link>
    </div>
  )
}
