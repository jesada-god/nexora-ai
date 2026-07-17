'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Star, Search, PieChart, Wrench } from 'lucide-react';
import { cn } from '@/src/utils/cn';
import { appConfig } from '@/src/config/app';

const navItems = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Watchlist', href: '/watchlist', icon: Star },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Portfolio', href: '/portfolio', icon: PieChart },
  { name: 'Tools', href: '/tools', icon: Wrench },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex shrink-0 flex-col w-64 bg-[#0F172A] border-r border-slate-800 h-dvh sticky top-0">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D4FF00] flex items-center justify-center">
            <span className="text-black font-bold text-xl">N</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">{appConfig.name}</h1>
        </div>
      </div>
      
      <nav className="flex-1 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-6 py-3 transition-colors',
                isActive 
                  ? 'text-[#D4FF00] bg-[#D4FF00]/10 border-r-4 border-[#D4FF00] font-medium' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-6">
        <div className="p-4 bg-purple-500/10 rounded-xl border border-purple-500/30">
          <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-1">Pro Analysis</p>
          <p className="text-sm text-slate-300">What-If & Monte Carlo Ready</p>
        </div>
      </div>
    </aside>
  );
}
