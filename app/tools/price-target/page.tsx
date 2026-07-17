'use client';
import { useState } from 'react';
import Header from '@/src/components/layout/Header';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { Target, ArrowLeft, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/src/components/ui/Toast';

export default function PriceTargetPage() {
  const router = useRouter();
  const { addToast } = useToast();
  
  const [eps, setEps] = useState('');
  const [pe, setPe] = useState('');
  const [growth, setGrowth] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const calculate = () => {
    if (!eps || !pe || !growth) {
      addToast({ title: 'ข้อผิดพลาด', message: 'กรุณากรอกข้อมูลให้ครบถ้วน', type: 'error' });
      return;
    }
    setLoading(true);
    // Simulate delay
    setTimeout(() => {
      const g = parseFloat(growth) / 100;
      const futureEps = parseFloat(eps) * Math.pow(1 + g, 5); // 5 year projection
      const target = futureEps * parseFloat(pe);
      setResult(target);
      setLoading(false);
    }, 600);
  };

  return (
    <div>
      <Header title="Price Target Calculator" />
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="px-0 mb-4" onClick={() => router.back()}>
          <ArrowLeft size={16} className="mr-2" /> กลับไปหน้าเครื่องมือ
        </Button>
        
        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-[#D4FF00]/10 text-[#D4FF00] rounded-xl"><Target size={24}/></div>
            <div>
              <h2 className="text-xl font-bold text-white">ประเมินมูลค่าด้วย P/E Multiple</h2>
              <p className="text-xs text-slate-400">คำนวณราคาเป้าหมายในอีก 5 ปีข้างหน้า</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">EPS ปัจจุบัน (กำไรต่อหุ้น)</label>
              <Input type="number" placeholder="เช่น 5.2" value={eps} onChange={e => setEps(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">P/E คาดหวังในอนาคต</label>
              <Input type="number" placeholder="เช่น 15" value={pe} onChange={e => setPe(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">อัตราการเติบโตของกำไรต่อปี (%)</label>
              <Input type="number" placeholder="เช่น 10" value={growth} onChange={e => setGrowth(e.target.value)} />
            </div>
            <Button className="w-full mt-4" onClick={calculate} isLoading={loading}>คำนวณราคาเป้าหมาย</Button>
          </div>
        </div>

        {result !== null && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 animate-in fade-in slide-in-from-bottom-4">
             <div className="flex justify-between items-start">
               <div>
                 <p className="text-emerald-500 font-medium mb-1">ราคาเป้าหมาย (5 ปี)</p>
                 <h3 className="text-4xl font-mono font-bold text-emerald-400">{result.toFixed(2)}</h3>
                 <p className="text-xs text-emerald-500/70 mt-2">* ข้อมูลจำลอง ไม่ใช่คำแนะนำการลงทุน</p>
               </div>
               <Button variant="outline" className="border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/20" onClick={() => addToast({title: 'บันทึกสำเร็จ', type: 'success'})}>
                 <Save size={16} className="mr-2"/> บันทึกผลลัพธ์
               </Button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
