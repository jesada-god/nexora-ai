'use client';
import { useState, use } from 'react';
import Header from '@/src/components/layout/Header';
import { ArrowLeft, Star, Share2, Bell, Activity, Clock } from 'lucide-react';
import { useStore } from '@/src/store/useStore';
import { mockAssets, mockMarketIndices } from '@/src/mocks/marketData';
import { Tabs } from '@/src/components/ui/Tabs';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { Input } from '@/src/components/ui/Input';
import { useToast } from '@/src/components/ui/Toast';
import { formatCurrency, formatCompact } from '@/src/utils/format';
import { useRouter } from 'next/navigation';
import MockChart from '@/src/components/ui/MockChart';
import { appConfig } from '@/src/config/app';

export default function StockDetail({ params }: { params: Promise<{ symbol: string }> }) {
  const resolvedParams = use(params);
  const symbol = decodeURIComponent(resolvedParams.symbol);
  const router = useRouter();
  const { addToast } = useToast();
  
  const { favorites, toggleFavorite, addNotification } = useStore();
  const isFavorite = favorites.includes(symbol);

  const asset = [...mockAssets, ...mockMarketIndices].find(a => a.symbol === symbol);

  const [activeTab, setActiveTab] = useState('Overview');
  const [timeframe, setTimeframe] = useState('1D');
  const [showEma, setShowEma] = useState(true);
  
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState('');

  if (!asset) {
    return (
      <div>
         <Header title="ไม่พบข้อมูลหุ้น" />
         <div className="p-8 text-center">
            <p>ไม่พบข้อมูลสำหรับ {symbol}</p>
            <Button className="mt-4" onClick={() => router.back()}>กลับ</Button>
         </div>
      </div>
    );
  }

  const isPositive = asset.change >= 0;

  const handleShare = () => {
    addToast({ title: 'คัดลอกลิงก์แล้ว', message: 'คุณสามารถแชร์ลิงก์นี้ได้เลย', type: 'success' });
  };

  const handleSaveAlert = () => {
    if(!alertPrice) return;
    addNotification({ title: `ตั้งเตือน ${symbol} แล้ว`, message: `เมื่อราคาถึง ${alertPrice}`, type: 'INFO', read: false });
    addToast({ title: 'ตั้งการแจ้งเตือนสำเร็จ', type: 'success' });
    setIsAlertModalOpen(false);
    setAlertPrice('');
  };

  const srLevels = {
    R3: asset.price * 1.08,
    R2: asset.price * 1.05,
    R1: asset.price * 1.02,
    S1: asset.price * 0.98,
    S2: asset.price * 0.95,
    S3: asset.price * 0.92,
  };

  return (
    <div className="pb-20">
      <div className="sticky top-0 z-40 bg-[#0A0E17]/90 backdrop-blur-md border-b border-slate-800 p-4 flex items-center justify-between">
         <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-2 -ml-2 text-slate-400 hover:text-white rounded-full">
              <ArrowLeft size={20} />
            </button>
            <div>
               <h1 className="text-lg font-bold text-white leading-tight">{asset.symbol}</h1>
               <p className="text-[10px] text-slate-500">{asset.name} • {asset.market}</p>
            </div>
         </div>
         <div className="flex items-center gap-1">
            <button onClick={() => toggleFavorite(symbol)} className={`p-2 rounded-full transition-colors ${isFavorite ? 'text-[#D4FF00]' : 'text-slate-400 hover:text-white'}`}>
              <Star size={20} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <button onClick={() => setIsAlertModalOpen(true)} className="p-2 text-slate-400 hover:text-white rounded-full">
              <Bell size={20} />
            </button>
            <button onClick={handleShare} className="p-2 text-slate-400 hover:text-white rounded-full">
              <Share2 size={20} />
            </button>
         </div>
      </div>

      <div className="p-4 md:p-8 space-y-6">
        <div className="flex justify-between items-end">
           <div>
             <h2 className="text-4xl md:text-5xl font-mono font-bold text-white tracking-tight">
               {formatCurrency(asset.price, asset.currency, false)}
             </h2>
             <div className={`flex items-center gap-2 mt-2 font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
               <span className="text-lg">{isPositive ? '+' : ''}{asset.change.toFixed(2)}</span>
               <span className={`px-2 py-0.5 rounded text-xs ${isPositive ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                 {isPositive ? '+' : ''}{asset.changePercent.toFixed(2)}%
               </span>
               <span className="text-xs text-slate-500 font-normal ml-2 flex items-center gap-1"><Clock size={12}/> {timeframe}</span>
             </div>
           </div>
        </div>

        {/* Chart Section */}
        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-4 shadow-xl">
           <div className="flex justify-between items-center mb-4">
             <div className="flex gap-1">
               {['1D', '1W', '1M', '3M', '1Y', 'ALL'].map(tf => (
                 <button 
                   key={tf} 
                   onClick={() => setTimeframe(tf)}
                   className={`px-3 py-1 text-[10px] font-bold rounded-full transition-colors ${timeframe === tf ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                   {tf}
                 </button>
               ))}
             </div>
             <button 
               onClick={() => setShowEma(!showEma)}
               className={`text-[10px] px-2 py-1 rounded border ${showEma ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'border-slate-700 text-slate-500'}`}
             >
               EMA 20/50
             </button>
           </div>
           
           <div className="h-[250px] md:h-[350px] w-full">
              <MockChart basePrice={asset.price} showEma={showEma} />
           </div>
        </div>

        {/* Support / Resistance */}
        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-4 shadow-xl grid grid-cols-2 gap-4">
           <div>
             <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Resistance Levels</p>
             <div className="space-y-1">
               <div className="flex justify-between text-xs"><span className="text-red-400">R3</span> <span className="font-mono text-white">{srLevels.R3.toFixed(2)}</span></div>
               <div className="flex justify-between text-xs"><span className="text-red-400">R2</span> <span className="font-mono text-white">{srLevels.R2.toFixed(2)}</span></div>
               <div className="flex justify-between text-xs"><span className="text-red-400">R1</span> <span className="font-mono text-white">{srLevels.R1.toFixed(2)}</span></div>
             </div>
           </div>
           <div>
             <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Support Levels</p>
             <div className="space-y-1">
               <div className="flex justify-between text-xs"><span className="text-emerald-400">S1</span> <span className="font-mono text-white">{srLevels.S1.toFixed(2)}</span></div>
               <div className="flex justify-between text-xs"><span className="text-emerald-400">S2</span> <span className="font-mono text-white">{srLevels.S2.toFixed(2)}</span></div>
               <div className="flex justify-between text-xs"><span className="text-emerald-400">S3</span> <span className="font-mono text-white">{srLevels.S3.toFixed(2)}</span></div>
             </div>
           </div>
        </div>

        {/* Tabs Content */}
        <div className="mt-8">
           <Tabs 
             tabs={['Overview', 'News', 'Analysis', 'Financials']} 
             activeTab={activeTab} 
             onChange={setActiveTab} 
           />
           
           <div className="mt-6">
             {activeTab === 'Overview' && (
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 {[
                   { label: 'Market Cap', value: asset.marketCap ? formatCompact(asset.marketCap) : '-' },
                   { label: 'Volume', value: asset.volume ? formatCompact(asset.volume) : '-' },
                   { label: 'Avg Volume', value: asset.avgVolume ? formatCompact(asset.avgVolume) : '-' },
                   { label: 'P/E Ratio', value: asset.peRatio ? asset.peRatio.toFixed(2) : '-' },
                   { label: 'EPS', value: asset.eps ? asset.eps.toFixed(2) : '-' },
                   { label: 'Div Yield', value: asset.dividendYield ? `${asset.dividendYield}%` : '-' },
                   { label: '52W High', value: asset.high52w ? asset.high52w.toFixed(2) : '-' },
                   { label: '52W Low', value: asset.low52w ? asset.low52w.toFixed(2) : '-' },
                 ].map((stat, i) => (
                   <div key={i} className="bg-[#151B28] border border-slate-800 p-4 rounded-xl">
                     <p className="text-[10px] text-slate-500 uppercase mb-1">{stat.label}</p>
                     <p className="font-mono text-sm text-white">{stat.value}</p>
                   </div>
                 ))}
               </div>
             )}

             {activeTab === 'News' && (
               <div className="space-y-4">
                 {[1,2,3].map(i => (
                   <div key={i} className="bg-[#151B28] border border-slate-800 p-4 rounded-xl">
                     <h4 className="text-sm font-bold text-white mb-2">ข่าวล่าสุดเกี่ยวกับ {asset.symbol} แบบจำลอง {i}</h4>
                     <p className="text-xs text-slate-400 line-clamp-2">เนื้อหาข่าวจำลองเพื่อการสาธิต UI เท่านั้น สามารถเชื่อมต่อ API จริงในภายหลังเพื่อแสดงผลข่าวสารอัปเดต...</p>
                     <p className="text-[10px] text-slate-500 mt-2">{i} ชั่วโมงที่แล้ว</p>
                   </div>
                 ))}
               </div>
             )}

             {activeTab === 'Analysis' && (
               <div className="bg-[#151B28] border border-slate-800 p-6 rounded-xl text-center">
                 <Activity className="mx-auto text-[#D4FF00] mb-4" size={32} />
                 <h4 className="font-bold text-white mb-2">{appConfig.name} Analysis</h4>
                 <p className="text-sm text-slate-400 mb-4">แนวโน้มทางเทคนิคระยะสั้น: <span className="text-emerald-500 font-bold">BULLISH</span><br/>โมเมนตัม RSI อยู่ในระดับ 65 แสดงถึงแรงซื้อที่แข็งแกร่ง</p>
                 <Button variant="outline" size="sm">ดูการวิเคราะห์ฉบับเต็ม</Button>
               </div>
             )}

             {activeTab === 'Financials' && (
               <div className="bg-[#151B28] border border-slate-800 p-6 rounded-xl flex items-center justify-center h-40">
                  <p className="text-slate-500 text-sm">ข้อมูลการเงิน (รอการเชื่อมต่อ API)</p>
               </div>
             )}
           </div>
        </div>
      </div>

      <Modal isOpen={isAlertModalOpen} onClose={() => setIsAlertModalOpen(false)} title="ตั้งการแจ้งเตือนราคา">
         <div className="space-y-4">
           <div>
             <label className="text-sm text-slate-400 mb-1 block">ราคาเป้าหมาย</label>
             <Input 
               type="number" 
               placeholder={asset.price.toFixed(2)} 
               value={alertPrice}
               onChange={(e) => setAlertPrice(e.target.value)}
             />
           </div>
           <div className="flex gap-2">
             <Button variant="outline" size="sm" className="flex-1" onClick={() => setAlertPrice(srLevels.R1.toFixed(2))}>R1</Button>
             <Button variant="outline" size="sm" className="flex-1" onClick={() => setAlertPrice(srLevels.S1.toFixed(2))}>S1</Button>
           </div>
           <Button className="w-full mt-4" onClick={handleSaveAlert}>บันทึก</Button>
         </div>
      </Modal>
    </div>
  );
}
