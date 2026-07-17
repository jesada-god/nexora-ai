'use client';
import { useState, useMemo } from 'react';
import Header from '@/src/components/layout/Header';
import { Star, Plus, MoreHorizontal, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { useStore } from '@/src/store/useStore';
import { mockAssets } from '@/src/mocks/marketData';
import { formatCurrency } from '@/src/utils/format';
import Sparkline from '@/src/components/ui/Sparkline';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { useRouter } from 'next/navigation';

export default function WatchlistPage() {
  const router = useRouter();
  const { watchlists, activeWatchlistId, setActiveWatchlist, addWatchlist, removeFromWatchlist } = useStore();
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');

  const activeWatchlist = watchlists.find(w => w.id === activeWatchlistId) || watchlists[0];
  
  const watchlistAssets = useMemo(() => {
    if (!activeWatchlist) return [];
    return activeWatchlist.symbols.map(sym => mockAssets.find(a => a.symbol === sym)).filter(Boolean);
  }, [activeWatchlist]);

  const handleCreateWatchlist = () => {
    if (newWatchlistName.trim()) {
      addWatchlist(newWatchlistName.trim());
      setNewWatchlistName('');
      setIsCreateModalOpen(false);
    }
  };

  return (
    <div>
      <Header title="วอทช์ลิสต์ (Watchlist)" subtitle="ติดตามหุ้นที่คุณสนใจ" />
      
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex gap-4 p-5 border-b border-slate-800 overflow-x-auto scrollbar-hide items-center bg-[#151B28] rounded-t-2xl border-x border-t border-slate-800 shadow-xl">
          {watchlists.map(w => (
            <button 
              key={w.id}
              onClick={() => setActiveWatchlist(w.id)}
              className={`text-sm whitespace-nowrap px-1 pb-1 border-b-2 transition-colors ${
                activeWatchlistId === w.id 
                  ? 'font-bold text-[#D4FF00] border-[#D4FF00]' 
                  : 'font-medium text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              {w.name}
            </button>
          ))}
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="text-[10px] bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700 ml-auto whitespace-nowrap flex items-center gap-1 hover:bg-slate-700 transition-colors"
          >
            <Plus size={12} /> สร้าง Watchlist
          </button>
        </div>

        <div className="bg-[#151B28] border-x border-b border-slate-800 rounded-b-2xl overflow-hidden mt-0 shadow-xl">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-[#151B28]">
            <h2 className="text-[10px] uppercase text-slate-500 tracking-wider font-semibold">Symbol & Price</h2>
            <button className="text-[10px] bg-slate-800 text-slate-300 px-3 py-1 rounded-full border border-slate-700 hover:bg-slate-700 transition-colors">Edit Watchlist</button>
          </div>
          
          <div className="divide-y divide-slate-800/50">
            {watchlistAssets.length > 0 ? watchlistAssets.map((asset) => {
              if (!asset) return null;
              const isPositive = asset.change >= 0;
              return (
                <div 
                  key={asset.symbol} 
                  onClick={() => router.push(`/stock/${asset.symbol}`)}
                  className="px-6 py-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-4 w-1/3">
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFromWatchlist(activeWatchlistId, asset.symbol); }}
                      className="text-slate-600 hover:text-[#D4FF00] transition-colors"
                    >
                      <Star size={18} fill="currentColor" />
                    </button>
                    <div>
                      <h3 className="font-bold text-white group-hover:text-[#D4FF00] transition-colors">{asset.symbol}</h3>
                      <p className="text-[10px] text-slate-500 line-clamp-1">{asset.name}</p>
                    </div>
                  </div>
                  
                  <div className="w-1/4 h-8 hidden md:block opacity-60">
                    <Sparkline data={asset.sparkline} isPositive={isPositive} />
                  </div>

                  <div className="w-1/3 text-right flex flex-col items-end">
                    <span className="font-mono text-white font-medium">{formatCurrency(asset.price, asset.currency, false)}</span>
                    <span className={`text-xs font-bold flex items-center gap-0.5 ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                      {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {Math.abs(asset.changePercent).toFixed(2)}%
                    </span>
                  </div>

                  <button className="ml-4 text-slate-600 hover:text-white p-2 md:hidden">
                    <MoreHorizontal size={20} />
                  </button>
                </div>
              );
            }) : (
              <EmptyState 
                icon={Star} 
                title="รายการโปรดว่างเปล่า" 
                description="ค้นหาและเพิ่มหุ้นที่คุณสนใจลงใน Watchlist เพื่อติดตามราคาอย่างใกล้ชิด" 
                action={<Button onClick={() => router.push('/search')}><Search size={16} className="mr-2"/> ค้นหาหุ้น</Button>}
              />
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="สร้าง Watchlist ใหม่">
        <div className="space-y-4">
          <Input 
            value={newWatchlistName} 
            onChange={(e) => setNewWatchlistName(e.target.value)} 
            placeholder="ชื่อ Watchlist เช่น หุ้นปันผลสูง" 
            autoFocus 
          />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>ยกเลิก</Button>
            <Button onClick={handleCreateWatchlist} disabled={!newWatchlistName.trim()}>สร้าง</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
