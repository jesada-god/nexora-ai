'use client';
import { useState, useMemo } from 'react';
import Header from '@/src/components/layout/Header';
import { Search, X, History, TrendingUp, Plus } from 'lucide-react';
import { useStore } from '@/src/store/useStore';
import { mockAssets, mockMarketIndices } from '@/src/mocks/marketData';
import { Tabs } from '@/src/components/ui/Tabs';
import { useRouter } from 'next/navigation';
import { useToast } from '@/src/components/ui/Toast';

export default function SearchPage() {
  const router = useRouter();
  const { recentSearches, addRecentSearch, clearRecentSearches, activeWatchlistId, addToWatchlist } = useStore();
  const { addToast } = useToast();
  
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');

  const searchResults = useMemo(() => {
    if (!query) return [];
    const allAssets = [...mockAssets, ...mockMarketIndices];
    const q = query.toLowerCase();
    return allAssets.filter(a => 
      (activeTab === 'ALL' || a.type === activeTab.slice(0, -1) || (activeTab === 'STOCKS' && a.type === 'STOCK')) &&
      (a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    );
  }, [query, activeTab]);

  const handleResultClick = (symbol: string) => {
    addRecentSearch(symbol);
    router.push(`/stock/${symbol}`);
  };

  const handleAddWatchlist = (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    addToWatchlist(activeWatchlistId, symbol);
    addToast({ title: "เพิ่มเข้า Watchlist แล้ว", message: `${symbol} ถูกเพิ่มลงในรายการโปรด`, type: "success" });
  };

  return (
    <div>
      <Header title="ค้นหา (Search)" />
      
      <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา Symbol, Company Name..." 
            className="w-full bg-[#151B28] border border-slate-700 rounded-xl py-4 pl-12 pr-12 text-white placeholder:text-slate-500 focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/50 transition-all text-lg"
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1">
              <X size={16} />
            </button>
          )}
        </div>

        <Tabs tabs={['ALL', 'STOCKS', 'CRYPTO', 'INDICES']} activeTab={activeTab} onChange={setActiveTab} />

        {query ? (
          <div className="bg-[#151B28] rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
             {searchResults.length > 0 ? (
               <div className="divide-y divide-slate-800/50">
                 {searchResults.map(result => (
                   <div 
                     key={result.symbol} 
                     onClick={() => handleResultClick(result.symbol)}
                     className="p-4 flex items-center justify-between hover:bg-slate-800/50 cursor-pointer transition-colors"
                   >
                     <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-slate-300">
                         {result.symbol.substring(0, 2)}
                       </div>
                       <div>
                         <h4 className="font-bold text-white">{result.symbol}</h4>
                         <p className="text-[10px] text-slate-500">{result.name} &bull; {result.market}</p>
                       </div>
                     </div>
                     <div className="flex items-center gap-4">
                       <div className="text-right">
                         <p className="font-mono text-white text-sm">{result.price.toFixed(2)}</p>
                         <p className={`text-[10px] font-bold ${result.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                           {result.change >= 0 ? '+' : ''}{result.changePercent.toFixed(2)}%
                         </p>
                       </div>
                       <button 
                         onClick={(e) => handleAddWatchlist(e, result.symbol)}
                         className="p-2 text-slate-500 hover:text-[#D4FF00] hover:bg-[#D4FF00]/10 rounded-full transition-colors"
                       >
                         <Plus size={20} />
                       </button>
                     </div>
                   </div>
                 ))}
               </div>
             ) : (
               <div className="p-8 text-center text-slate-500">
                 ไม่พบข้อมูลสำหรับ &quot;{query}&quot;
               </div>
             )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
               <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <History size={16} className="text-slate-400" /> Recent Searches
                  </h3>
                  {recentSearches.length > 0 && (
                    <button onClick={clearRecentSearches} className="text-xs text-slate-500 hover:text-white">Clear</button>
                  )}
               </div>
               {recentSearches.length > 0 ? (
                 <div className="flex flex-wrap gap-2">
                    {recentSearches.map(term => (
                      <button 
                        key={term} 
                        onClick={() => setQuery(term)}
                        className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg hover:bg-slate-700 transition-colors"
                      >
                        {term}
                      </button>
                    ))}
                 </div>
               ) : (
                 <p className="text-sm text-slate-500">ไม่มีประวัติการค้นหา</p>
               )}
            </div>

            <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
               <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
                 <TrendingUp size={16} className="text-emerald-500" /> Trending Assets
               </h3>
               <div className="space-y-3">
                 {['NVDA', 'AAPL', 'TSLA'].map(sym => (
                   <div 
                     key={sym} 
                     onClick={() => handleResultClick(sym)}
                     className="flex items-center justify-between p-2 hover:bg-slate-800/50 rounded-lg cursor-pointer transition-colors"
                   >
                     <span className="font-bold text-white text-sm">{sym}</span>
                     <span className="text-xs text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">Hot</span>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
