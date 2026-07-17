import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

interface MainLayoutProps {
  children: ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-dvh w-full max-w-full bg-[#0A0E17] text-slate-200 font-sans overflow-x-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 flex flex-col min-h-dvh lg:h-dvh lg:overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 bg-gradient-to-br from-[#0A0E17] via-[#0F172A] to-[#111827]">
        <div className="flex-1 w-full max-w-[1600px] mx-auto pb-6">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
