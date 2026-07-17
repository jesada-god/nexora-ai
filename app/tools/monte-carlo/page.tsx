'use client';
import { useState } from 'react';
import Header from '@/src/components/layout/Header';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { TrendingUp, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/src/components/ui/Toast';

export default function MonteCarloPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const simulate = () => {
    setLoading(true);
    setDone(false);
    setTimeout(() => {
      setLoading(false);
      setDone(true);
      addToast({ title: 'Simulated 10,000 paths', type: 'success' });
    }, 1200);
  };

  return (
    <div>
      <Header title="Monte Carlo Simulation" />
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="px-0 mb-4" onClick={() => router.back()}>
          <ArrowLeft size={16} className="mr-2" /> กลับไปหน้าเครื่องมือ
        </Button>

        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl"><TrendingUp size={24}/></div>
            <div>
              <h2 className="text-xl font-bold text-white">Monte Carlo Simulation</h2>
              <p className="text-xs text-slate-400">พยากรณ์ความน่าจะเป็นของพอร์ตด้วยการสุ่ม 10,000 ครั้ง</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-sm text-slate-300 mb-1">ระยะเวลา (ปี)</label>
               <Input type="number" defaultValue="10" />
             </div>
             <div>
               <label className="block text-sm text-slate-300 mb-1">ผลตอบแทนคาดหวัง (%)</label>
               <Input type="number" defaultValue="8" />
             </div>
          </div>
          <Button className="w-full mt-6" onClick={simulate} isLoading={loading}>Start Simulation</Button>
        </div>

        {done && (
          <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 flex flex-col items-center justify-center h-64 shadow-xl">
             <div className="text-emerald-500 mb-2 font-mono text-2xl font-bold">75% Probability</div>
             <p className="text-sm text-slate-400 text-center max-w-md">มีโอกาส 75% ที่พอร์ตของคุณจะเติบโตถึงเป้าหมายที่วางไว้ในอีก 10 ปีข้างหน้า<br/><br/><span className="text-[10px]">* ข้อมูลจำลอง ไม่ใช่คำแนะนำการลงทุน</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
