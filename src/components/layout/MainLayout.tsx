import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { OfflineNotice } from '@/src/components/ui/OfflineNotice';
import { DataSourceBadge } from '@/src/components/ui/DataSourceBadge';

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-dvh w-full max-w-full bg-[#0A0E17] text-slate-200 font-sans overflow-x-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 flex flex-col min-h-dvh lg:h-dvh lg:overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 bg-gradient-to-br from-[#0A0E17] via-[#0F172A] to-[#111827]">
        <OfflineNotice />
        <div className="flex min-h-8 items-center justify-center gap-2 border-b border-amber-400/20 bg-amber-400/5 px-3 py-1 text-center text-[10px] text-amber-200">
          <DataSourceBadge />
          <span className="hidden sm:inline">ค่าตลาดและพอร์ตเริ่มต้นเป็นข้อมูลตัวอย่าง ไม่ใช่ข้อมูลจริง</span>
        </div>
        <div className="flex-1 w-full max-w-[1600px] mx-auto pb-6">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
