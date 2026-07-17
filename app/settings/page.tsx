'use client';
import Header from "@/src/components/layout/Header";
import { useStore } from "@/src/store/useStore";
import { Button } from "@/src/components/ui/Button";
import { Select } from "@/src/components/ui/Select";
import { useState } from "react";
import { useToast } from "@/src/components/ui/Toast";
import { appConfig } from "@/src/config/app";

export default function SettingsPage() {
  const { currency, toggleCurrency } = useStore();
  const { addToast } = useToast();
  const [lang, setLang] = useState('th');

  const handleSave = () => {
    addToast({ title: "บันทึกสำเร็จ", message: "อัปเดตการตั้งค่าเรียบร้อยแล้ว", type: "success" });
  };

  return (
    <div>
      <Header title="การตั้งค่า (Settings)" subtitle="ปรับแต่งการแสดงผล" />
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-8">
        
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">แสดงผล (Display)</h3>
          
          <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">สกุลเงินหลัก (Base Currency)</p>
                <p className="text-xs text-slate-400">ใช้ในการแสดงมูลค่าพอร์ต</p>
              </div>
              <div className="w-32">
                <Select value={currency} onChange={toggleCurrency}>
                  <option value="THB">THB (฿)</option>
                  <option value="USD">USD ($)</option>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">ภาษา (Language)</p>
              </div>
              <div className="w-32">
                <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="th">ไทย</option>
                  <option value="en">English</option>
                </Select>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">ธีมสี (Theme)</p>
                <p className="text-xs text-slate-400">{appConfig.name} Technical Dark (Default)</p>
              </div>
              <div className="w-32">
                <Select disabled>
                  <option>Dark/Neon</option>
                </Select>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">การแจ้งเตือน (Notifications)</h3>
          <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 space-y-4 text-slate-400 text-sm">
             <div className="flex items-center justify-between">
               <span>ราคาถึงเป้าหมาย (Price Alerts)</span>
               <input type="checkbox" defaultChecked className="accent-[#D4FF00]" />
             </div>
             <div className="flex items-center justify-between">
               <span>สรุปตลาดรายวัน (Daily Summary)</span>
               <input type="checkbox" defaultChecked className="accent-[#D4FF00]" />
             </div>
          </div>
        </section>

        <div className="pt-4 border-t border-slate-800 flex justify-end gap-4">
           <Button variant="outline">ยกเลิก</Button>
           <Button onClick={handleSave}>บันทึกการตั้งค่า</Button>
        </div>

      </div>
    </div>
  );
}
