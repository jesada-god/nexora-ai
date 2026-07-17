'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Star, Search, PieChart, Wrench } from 'lucide-react';
import { cn } from '@/src/utils/cn';

const navItems = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Watchlist', href: '/watchlist', icon: Star },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Portfolio', href: '/portfolio', icon: PieChart },
  { name: 'Tools', href: '/tools', icon: Wrench },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#0A0E17]/95 backdrop-blur-md border-t border-[#1e293b] pb-[env(safe-area-inset-bottom)] z-50">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center w-full h-full space-y-1',
                isActive ? 'text-[#D4FF00]' : 'text-[#94a3b8] hover:text-white transition-colors'
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
