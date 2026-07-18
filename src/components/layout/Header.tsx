'use client';
import { Search, Bell, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { appConfig } from '@/src/config/app';
import { useEffect, useState } from 'react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  status?: {
    text: string;
    indicator: 'green' | 'yellow' | 'red';
  };
}

export default function Header({ title, subtitle, status }: HeaderProps) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    const load = () => { void fetch('/api/notifications/unread-count').then((response) => response.json()).then((data) => setUnreadCount(Number(data.count) || 0)).catch(() => undefined); };
    load(); window.addEventListener('notifications-updated', load);
    return () => window.removeEventListener('notifications-updated', load);
  }, []);

  return (
    <header className="min-h-16 border-b border-slate-800 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 bg-[#0A0E17]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="lg:hidden shrink-0 w-9 h-9 rounded-lg bg-[#D4FF00] text-black font-black flex items-center justify-center" aria-label={appConfig.name}>N</div>
        <div>
          <p className="lg:hidden text-xs leading-none text-[#D4FF00] font-semibold mb-1">{appConfig.name}</p>
          <h2 className="text-base sm:text-lg font-semibold text-white truncate">{title}</h2>
          {subtitle && <p className="hidden sm:block text-xs text-slate-400 truncate">{subtitle}</p>}
        </div>
        
        {status && (
          <div className="hidden md:flex items-center gap-2 bg-emerald-500/10 px-2 py-1 rounded-full ml-4">
            <span className={`w-2 h-2 rounded-full ${
              status.indicator === 'green' ? 'bg-emerald-500 shadow-[0_0_8px_#10B981]' : 
              status.indicator === 'yellow' ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'
            }`} />
            <span className={`text-[10px] font-bold uppercase tracking-tighter ${
              status.indicator === 'green' ? 'text-emerald-500' : 
              status.indicator === 'yellow' ? 'text-[#F59E0B]' : 'text-[#EF4444]'
            }`}>
              {status.text}
            </span>
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-4 md:gap-6">
        <div 
          className="hidden md:block relative cursor-text"
          onClick={() => router.push('/search')}
        >
          <input 
            type="text" 
            placeholder="ค้นหาหุ้น... (Symbol, Name)" 
            className="min-h-11 w-64 rounded-lg border border-slate-700 bg-[#151B28] px-4 py-2 text-xs focus:border-[#D4FF00] focus:outline-none pointer-events-none"
            readOnly
          />
          <kbd className="absolute right-2 top-1.5 px-1.5 py-0.5 bg-slate-800 text-[10px] text-slate-500 border border-slate-700 rounded">⌘K</kbd>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button 
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-white md:hidden"
            onClick={() => router.push('/search')}
            aria-label="ค้นหา"
          >
            <Search size={20} />
          </button>
          <button 
            className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            onClick={() => router.push('/notifications')}
            aria-label={`การแจ้งเตือน${unreadCount > 0 ? `ที่ยังไม่ได้อ่าน ${unreadCount} รายการ` : ''}`}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#D4FF00] rounded-full border-2 border-[#0A0E17]" />
            )}
          </button>
          <button 
            className="w-11 h-11 rounded-full border-2 border-[#D4FF00] bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors overflow-hidden"
            onClick={() => router.push('/profile')}
            aria-label="โปรไฟล์"
          >
            <User size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
