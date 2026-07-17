'use client';
import Header from "@/src/components/layout/Header";
import { Button } from "@/src/components/ui/Button";
import { User, Settings, LogOut, ChevronRight, Shield, CreditCard } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/src/components/ui/Toast";

export default function ProfilePage() {
  const { addToast } = useToast();

  const handleLogout = () => {
    addToast({ title: "ระบบจำลอง", message: "ฟังก์ชันออกจากระบบยังไม่เปิดใช้งาน", type: "info" });
  };

  return (
    <div>
      <Header title="โปรไฟล์ (Profile)" />
      <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
        
        <div className="bg-[#151B28] rounded-2xl border border-slate-800 p-6 flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-slate-800 border-2 border-[#D4FF00] flex items-center justify-center text-slate-400">
            <User size={40} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Guest User</h2>
            <p className="text-slate-400">Pro Plan (Simulation)</p>
            <div className="mt-2 flex gap-2">
              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-xs rounded font-medium">Monte Carlo Enabled</span>
            </div>
          </div>
        </div>

        <div className="bg-[#151B28] rounded-2xl border border-slate-800 overflow-hidden">
          <Link href="/settings" className="flex items-center justify-between p-4 border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center gap-3 text-slate-300">
              <Settings size={20} className="text-slate-400" />
              <span>การตั้งค่าแอป (Settings)</span>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </Link>
          <button className="w-full flex items-center justify-between p-4 border-b border-slate-800 hover:bg-slate-800/50 transition-colors text-left">
            <div className="flex items-center gap-3 text-slate-300">
              <Shield size={20} className="text-slate-400" />
              <span>ความปลอดภัย (Security)</span>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </button>
          <button className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors text-left">
            <div className="flex items-center gap-3 text-slate-300">
              <CreditCard size={20} className="text-slate-400" />
              <span>แผนการใช้งาน (Billing)</span>
            </div>
            <ChevronRight size={16} className="text-slate-500" />
          </button>
        </div>

        <Button variant="danger" className="w-full" onClick={handleLogout}>
          <LogOut size={16} className="mr-2" /> ออกจากระบบ
        </Button>

      </div>
    </div>
  );
}
