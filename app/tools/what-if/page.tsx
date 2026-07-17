'use client';
import { useState } from 'react';
import Header from '@/src/components/layout/Header';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { Shuffle, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/src/components/ui/Toast';
import { EmptyState } from '@/src/components/ui/EmptyState';

export default function WhatIfPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);

  const simulate = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      addToast({ title: 'จำลองผลสำเร็จ', message: 'ดูผลกระทบด้านล่าง', type: 'success' });
    }, 800);
  };

  return (
    <div>
      <Header title="What-If Analysis" />
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="px-0 mb-4" onClick={() => router.back()}>
          <ArrowLeft size={16} className="mr-2" /> กลับไปหน้าเครื่องมือ
        </Button>

        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl"><Shuffle size={24}/></div>
            <div>
              <h2 className="text-xl font-bold text-white">จำลองสถานการณ์พอร์ตโฟลิโอ</h2>
              <p className="text-xs text-slate-400">ถ้าเกิดเหตุการณ์นี้ พอร์ตจะเป็นอย่างไร?</p>
            </div>
          </div>

          <div className="space-y-4">
             <div>
               <label className="block text-sm text-slate-300 mb-1">เลือกสถานการณ์ (Scenario)</label>
               <select className="w-full bg-[#151B28] border border-slate-700 rounded-xl px-3 py-2 text-white">
                 <option>ตลาดหุ้นปรับฐาน -20% (Bear Market)</option>
                 <option>เงินเฟ้อพุ่งสูงกว่าคาดการณ์ (High Inflation)</option>
                 <option>หุ้นกลุ่มเทคโนโลยีเติบโต +30%</option>
               </select>
             </div>
             <Button className="w-full" onClick={simulate} isLoading={loading}>Run Simulation</Button>
          </div>
        </div>

        <EmptyState 
           icon={Shuffle}
           title="ผลการจำลอง"
           description="กด Run Simulation เพื่อดูผลลัพธ์ว่าพอร์ตของคุณจะได้รับผลกระทบอย่างไรบ้าง"
        />
      </div>
    </div>
  );
}
