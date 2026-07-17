'use client';

import { useState } from 'react';
import Header from '@/src/components/layout/Header';
import AssetCard from '@/src/components/ui/AssetCard';
import { formatCurrency } from '@/src/utils/format';
import { useStore } from '@/src/store/useStore';
import { mockMarketIndices, mockAssets } from '@/src/mocks/marketData';
import { TrendingUp, PieChart, Star, Activity, Eye, EyeOff, ChevronRight, ArrowUpRight, ArrowDownRight, Newspaper, Calendar } from 'lucide-react';
import { Tabs } from '@/src/components/ui/Tabs';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const { currency, showBalances, toggleBalances, cashBalance, portfolio } = useStore();
  const [activeMarketTab, setActiveMarketTab] = useState('SET Index');

  // Calculate mock portfolio stats
  const totalValue = portfolio.reduce((acc, item) => acc + (item.shares * item.currentPrice), 0) + cashBalance;
  const previousValue = portfolio.reduce((acc, item) => acc + (item.shares * item.averageCost), 0) + cashBalance;
  const todayProfit = totalValue - previousValue;
  const todayProfitPercent = previousValue > 0 ? (todayProfit / previousValue) * 100 : 0;
  const isPositive = todayProfit >= 0;

  return (
    <div>
      <Header title="แดชบอร์ดหลัก" status={{ text: 'Market Open: SET (15:24)', indicator: 'green' }} />
      
      <div className="p-4 md:p-8 space-y-6 md:space-y-8">
        
        {/* Portfolio Summary Card */}
        <section className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between relative z-10 gap-4">
            <div>
              <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mb-2">Portfolio Value ({currency})</p>
              <div className="flex items-center gap-3">
                <h3 className="text-4xl font-bold tracking-tight text-white mb-2 font-mono">
                  {showBalances ? formatCurrency(totalValue, currency) : '฿***,***.**'}
                </h3>
                <button onClick={toggleBalances} className="text-[#94a3b8] hover:text-white p-2">
                  {showBalances ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <span className={`font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                  {showBalances ? `${isPositive ? '+' : ''}${formatCurrency(todayProfit, currency, false)}` : '***'}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${isPositive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                  {isPositive ? '+' : ''}{todayProfitPercent.toFixed(2)}% Today
                </span>
              </div>
            </div>
            
            <div className="flex flex-row md:flex-col gap-2">
              <button 
                onClick={() => router.push('/portfolio')}
                className="px-6 py-2 bg-[#D4FF00] text-black font-bold text-xs rounded-full hover:bg-[#e6ff4d] transition-colors"
              >
                เพิ่มรายการ / จัดการ
              </button>
              <button 
                onClick={() => router.push('/portfolio')}
                className="px-6 py-2 bg-slate-800 text-white font-bold text-xs rounded-full border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Summary View
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-[#1e293b]/50 relative z-10">
            {[
              { icon: TrendingUp, label: 'ภาพรวมตลาด', route: '/' },
              { icon: PieChart, label: 'พอร์ตของฉัน', route: '/portfolio' },
              { icon: Star, label: 'รายการโปรด', route: '/watchlist' },
              { icon: Activity, label: 'เครื่องมือวิเคราะห์', route: '/tools' },
            ].map((action, i) => (
              <button 
                key={i} 
                onClick={() => router.push(action.route)}
                className="flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-800/30 border border-slate-800/50 hover:bg-slate-800 transition-colors group"
              >
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-[#D4FF00] group-hover:scale-110 transition-transform mb-2">
                  <action.icon size={20} />
                </div>
                <span className="text-xs font-medium text-slate-300">{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Market Section */}
        <section className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">ตลาด & การลงทุน (Market Status)</h4>
            <button className="text-[10px] bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700">ดูทั้งหมด</button>
          </div>
          
          <Tabs 
            tabs={['SET Index', 'Global', 'Crypto', 'Commodities']} 
            activeTab={activeMarketTab} 
            onChange={setActiveMarketTab} 
          />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 md:gap-4 mt-2">
            {mockMarketIndices.map((asset) => (
              <AssetCard key={asset.symbol} asset={asset} />
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Movers */}
          <section className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
             <div className="flex justify-between items-center mb-6">
                <h4 className="text-sm font-bold text-white tracking-wide">Top Movers</h4>
                <span className="text-[10px] text-slate-500">Updated 1m ago</span>
             </div>
             <div className="space-y-4">
                {mockAssets.slice(0, 4).map(asset => (
                  <div key={asset.symbol} onClick={() => router.push(`/stock/${asset.symbol}`)} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition-colors border border-transparent hover:border-slate-800">
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center font-bold text-xs text-[#D4FF00]">{asset.symbol.substring(0, 3)}</div>
                       <div>
                         <p className="font-bold text-white text-sm">{asset.symbol}</p>
                         <p className="text-[10px] text-slate-500">{asset.name}</p>
                       </div>
                     </div>
                     <div className="text-right">
                       <p className="text-sm font-mono text-white">${asset.price.toFixed(2)}</p>
                       <p className={`text-[10px] font-bold flex items-center justify-end gap-1 ${asset.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                         {asset.change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                         {Math.abs(asset.changePercent).toFixed(2)}%
                       </p>
                     </div>
                  </div>
                ))}
             </div>
             <button onClick={() => router.push('/search')} className="mt-4 w-full py-2 bg-slate-800/50 text-[10px] text-slate-400 hover:text-white rounded border border-slate-700 uppercase tracking-widest">View All</button>
          </section>

          {/* Latest News */}
          <section className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
             <div className="flex justify-between items-center mb-6">
                <h4 className="text-sm font-bold text-white tracking-wide">Market News</h4>
                <Newspaper className="text-slate-500" size={16} />
             </div>
             <div className="space-y-4">
                {[
                  { title: "NVIDIA announces next-gen AI chips", time: "10 min ago", tag: "TECH" },
                  { title: "Fed leaves interest rates unchanged", time: "1 hour ago", tag: "MACRO" },
                  { title: "Apple to unveil new features at WWDC", time: "2 hours ago", tag: "AAPL" },
                  { title: "Oil prices surge amid geopolitical tensions", time: "3 hours ago", tag: "ENERGY" }
                ].map((news, i) => (
                  <div key={i} className="flex gap-4 p-3 rounded-xl hover:bg-slate-800/50 cursor-pointer transition-colors">
                     <div className="w-2 h-2 mt-1.5 rounded-full bg-[#D4FF00] shrink-0" />
                     <div>
                       <p className="text-sm text-slate-200 font-medium leading-snug">{news.title}</p>
                       <div className="flex gap-2 items-center mt-1">
                         <span className="text-[10px] text-slate-500">{news.time}</span>
                         <span className="text-[8px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{news.tag}</span>
                       </div>
                     </div>
                  </div>
                ))}
             </div>
          </section>
        </div>

      </div>
    </div>
  );
}
