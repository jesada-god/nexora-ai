'use client';
import { useState } from 'react';
import Header from '@/src/components/layout/Header';
import { useStore } from '@/src/store/useStore';
import { formatCurrency } from '@/src/utils/format';
import { Eye, EyeOff, Plus, ArrowUpRight, ArrowDownRight, History, Download, Briefcase } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { Drawer } from '@/src/components/ui/Drawer';
import { Tabs } from '@/src/components/ui/Tabs';
import { Input } from '@/src/components/ui/Input';
import { useToast } from '@/src/components/ui/Toast';
import { useRouter } from 'next/navigation';

export default function PortfolioPage() {
  const router = useRouter();
  const { currency, showBalances, toggleBalances, portfolio, cashBalance, addCashRecord } = useStore();
  const { addToast } = useToast();
  
  const [activeTab, setActiveTab] = useState('ALL');
  const [isCashRecordModalOpen, setIsCashRecordModalOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [cashRecordAmount, setCashRecordAmount] = useState('');

  const totalInvested = portfolio.reduce((acc, item) => acc + (item.shares * item.averageCost), 0);
  const totalCurrent = portfolio.reduce((acc, item) => acc + (item.shares * item.currentPrice), 0);
  const totalValue = totalCurrent + cashBalance;
  
  const totalProfit = totalCurrent - totalInvested;
  const totalProfitPercent = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const isPositive = totalProfit >= 0;

  const handleCashRecord = () => {
    const amt = parseFloat(cashRecordAmount);
    if (!isNaN(amt) && amt > 0) {
      addCashRecord(amt, currency);
      addToast({ title: 'บันทึกข้อมูลแล้ว', message: `เพิ่มยอดเงินสดย้อนหลัง ${formatCurrency(amt, currency)} ในพอร์ตจำลองแล้ว`, type: 'success' });
      setIsCashRecordModalOpen(false);
      setCashRecordAmount('');
    } else {
      addToast({ title: 'เกิดข้อผิดพลาด', message: 'กรุณากรอกจำนวนเงินที่ถูกต้อง', type: 'error' });
    }
  };

  return (
    <div>
      <Header title="พอร์ตโฟลิโอ (Portfolio)" subtitle="ติดตามสินทรัพย์จากข้อมูลที่บันทึกด้วยตนเอง" />
      
      <div className="p-4 md:p-8 space-y-6">
        {/* Main Balance Card */}
        <section className="bg-gradient-to-br from-[#151B28] to-[#0A0E17] border border-slate-800 rounded-3xl p-6 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-5 relative z-10">
            <div className="min-w-0">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mb-1">Total Balance ({currency})</p>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl min-[390px]:text-3xl md:text-5xl font-bold text-white tabular-nums tracking-tight font-mono break-all sm:break-normal">
                  {showBalances ? formatCurrency(totalValue, currency) : '฿***,***.**'}
                </h2>
                <button onClick={toggleBalances} className="text-[#94a3b8] hover:text-white p-2">
                  {showBalances ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-lg font-bold tabular-nums ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                  {showBalances ? `${isPositive ? '+' : ''}${formatCurrency(totalProfit, currency, false)}` : '***'}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${isPositive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                  ({isPositive ? '+' : ''}{totalProfitPercent.toFixed(2)}%)
                </span>
              </div>
            </div>
            
            <div className="w-full sm:w-auto flex flex-col gap-2">
              <Button onClick={() => setIsCashRecordModalOpen(true)} className="gap-2">
                <Plus size={16} /> บันทึกธุรกรรมย้อนหลัง
              </Button>
              <Button variant="outline" onClick={() => setIsHistoryDrawerOpen(true)} className="gap-2">
                <History size={16} /> ประวัติธุรกรรม
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8 pt-6 border-t border-slate-800">
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Invested Value</p>
              <p className="text-white font-mono font-medium">{showBalances ? formatCurrency(totalCurrent, currency) : '***'}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase tracking-widest mb-1">Cash Balance</p>
              <p className="text-white font-mono font-medium">{showBalances ? formatCurrency(cashBalance, currency) : '***'}</p>
            </div>
          </div>
        </section>

        {/* Holdings */}
        <section className="bg-[#151B28] rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
           <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div className="flex items-center gap-2">
                <Briefcase size={20} className="text-[#D4FF00]" />
                <h3 className="text-lg font-bold text-white">Holdings</h3>
             </div>
             <Tabs tabs={['ALL', 'STOCKS', 'CRYPTO']} activeTab={activeTab} onChange={setActiveTab} />
           </div>

           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 tracking-wider border-b border-slate-800">
                    <th className="px-5 py-4 font-semibold">Asset</th>
                    <th className="px-5 py-4 font-semibold text-right">Shares</th>
                    <th className="px-5 py-4 font-semibold text-right">Avg Cost</th>
                    <th className="px-5 py-4 font-semibold text-right">Current Price</th>
                    <th className="px-5 py-4 font-semibold text-right">Total Value</th>
                    <th className="px-5 py-4 font-semibold text-right">Return</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {portfolio.filter(p => activeTab === 'ALL' || p.type === activeTab.slice(0, -1)).map((pos) => {
                    const posProfit = (pos.currentPrice - pos.averageCost) * pos.shares;
                    const posProfitPct = ((pos.currentPrice - pos.averageCost) / pos.averageCost) * 100;
                    const posIsPos = posProfit >= 0;

                    return (
                      <tr 
                        key={pos.symbol} 
                        onClick={() => router.push(`/stock/${pos.symbol}`)}
                        className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors cursor-pointer group"
                      >
                        <td className="px-5 py-4 flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center font-bold text-xs group-hover:bg-white/10 transition-colors">{pos.symbol.substring(0, 2)}</div>
                          <div>
                            <p className="font-bold text-white">{pos.symbol}</p>
                            <p className="text-[10px] text-slate-500">{pos.name}</p>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-slate-300">{showBalances ? pos.shares.toLocaleString() : '***'}</td>
                        <td className="px-5 py-4 text-right font-mono text-slate-300">{showBalances ? pos.averageCost.toFixed(2) : '***'}</td>
                        <td className="px-5 py-4 text-right font-mono text-white">{pos.currentPrice.toFixed(2)}</td>
                        <td className="px-5 py-4 text-right font-mono text-white font-medium">{showBalances ? formatCurrency(pos.shares * pos.currentPrice, currency, false) : '***'}</td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex flex-col items-end">
                            <span className={`font-bold font-mono ${posIsPos ? 'text-emerald-500' : 'text-red-500'}`}>
                              {showBalances ? `${posIsPos ? '+' : ''}${posProfit.toFixed(2)}` : '***'}
                            </span>
                            <span className={`text-[10px] flex items-center gap-0.5 ${posIsPos ? 'text-emerald-500' : 'text-red-500'}`}>
                              {posIsPos ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {Math.abs(posProfitPct).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
             </table>
             {portfolio.length === 0 && (
               <div className="p-8 text-center text-slate-500">
                 คุณยังไม่มีสินทรัพย์ในพอร์ต
               </div>
             )}
           </div>
        </section>

      </div>

      <Modal isOpen={isCashRecordModalOpen} onClose={() => setIsCashRecordModalOpen(false)} title="บันทึกธุรกรรมย้อนหลัง">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">รายการนี้ใช้ปรับข้อมูลเงินสดในพอร์ตจำลองเท่านั้น ไม่มีการรับหรือโอนเงินจริง</p>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">ยอดเงินสดที่ต้องการบันทึก ({currency})</label>
            <Input 
              type="number" 
              placeholder="0.00" 
              value={cashRecordAmount} 
              onChange={(e) => setCashRecordAmount(e.target.value)} 
              className="text-lg font-mono font-bold"
            />
          </div>
          <div className="flex gap-2">
            {[1000, 5000, 10000].map(amt => (
              <Button key={amt} variant="outline" size="sm" onClick={() => setCashRecordAmount(amt.toString())} className="flex-1">+{amt}</Button>
            ))}
          </div>
          <Button onClick={handleCashRecord} className="w-full mt-4">บันทึกข้อมูลในพอร์ต</Button>
        </div>
      </Modal>

      <Drawer isOpen={isHistoryDrawerOpen} onClose={() => setIsHistoryDrawerOpen(false)} title="ประวัติธุรกรรม (History)">
        <div className="space-y-4">
           {[
             { type: 'DEPOSIT', amount: 50000, date: '2024-05-10', status: 'COMPLETED' },
             { type: 'ADD_ASSET', asset: 'NVDA', amount: 15000, date: '2024-05-08', status: 'COMPLETED' },
             { type: 'ADD_ASSET', asset: 'AAPL', amount: 8000, date: '2024-05-05', status: 'COMPLETED' },
           ].map((tx, i) => (
             <div key={i} className="p-4 bg-slate-800/30 rounded-xl border border-slate-800 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'DEPOSIT' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/20 text-blue-500'}`}>
                   {tx.type === 'DEPOSIT' ? <Download size={16} /> : <Briefcase size={16} />}
                 </div>
                 <div>
                   <p className="font-bold text-white text-sm">{tx.type === 'DEPOSIT' ? 'บันทึกยอดเงินสดย้อนหลัง' : `บันทึกรายการ ${tx.asset}`}</p>
                   <p className="text-[10px] text-slate-500">{tx.date}</p>
                 </div>
               </div>
               <div className="text-right">
                 <p className={`font-mono text-sm font-bold ${tx.type === 'DEPOSIT' ? 'text-emerald-500' : 'text-white'}`}>
                   {tx.type === 'DEPOSIT' ? '+' : '-'}{formatCurrency(tx.amount, currency, false)}
                 </p>
                 <span className="text-[10px] px-2 py-0.5 bg-slate-700 text-slate-300 rounded mt-1 inline-block">{tx.status}</span>
               </div>
             </div>
           ))}
        </div>
      </Drawer>
    </div>
  );
}
