import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { OfflineNotice } from '@/src/components/ui/OfflineNotice';

export default function MainLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh w-full max-w-full overflow-x-hidden bg-[#0A0E17] font-sans text-slate-200">
    <Sidebar />
    <main className="flex min-h-dvh min-w-0 flex-1 flex-col bg-gradient-to-br from-[#0A0E17] via-[#0F172A] to-[#111827] pb-[calc(4rem+env(safe-area-inset-bottom))] lg:h-dvh lg:overflow-y-auto lg:pb-0">
      <OfflineNotice />
      <div className="mx-auto w-full max-w-[1600px] flex-1 pb-6">{children}</div>
    </main>
    <BottomNav />
  </div>;
}
