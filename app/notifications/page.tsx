'use client';
import Header from "@/src/components/layout/Header";
import { useStore } from "@/src/store/useStore";
import { Bell, CheckCircle2, AlertTriangle, Info, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { format } from "date-fns";

export default function NotificationsPage() {
  const { notifications, markNotificationRead, clearNotifications } = useStore();

  const getIcon = (type: string) => {
    switch (type) {
      case 'SUCCESS': return <CheckCircle2 className="text-emerald-500" size={20} />;
      case 'ALERT': return <AlertTriangle className="text-red-500" size={20} />;
      default: return <Info className="text-blue-500" size={20} />;
    }
  };

  return (
    <div>
      <Header title="การแจ้งเตือน (Notifications)" />
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-white">Recent Updates</h2>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearNotifications} className="text-red-400 hover:text-red-300">
              <Trash2 size={16} className="mr-2" /> ล้างทั้งหมด
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="ไม่มีการแจ้งเตือน"
            description="คุณจะได้รับการแจ้งเตือนเมื่อมีการเคลื่อนไหวของตลาด หรือตั้งค่าแจ้งเตือนราคา"
          />
        ) : (
          <div className="space-y-4">
            {notifications.map((notif) => (
              <div 
                key={notif.id}
                onClick={() => !notif.read && markNotificationRead(notif.id)}
                className={`p-4 rounded-xl border flex gap-4 cursor-pointer transition-colors ${
                  notif.read ? 'bg-[#151B28] border-slate-800 opacity-70' : 'bg-[#1e293b] border-slate-700'
                }`}
              >
                <div className="mt-1">{getIcon(notif.type)}</div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className={`font-semibold ${notif.read ? 'text-slate-300' : 'text-white'}`}>{notif.title}</h4>
                    <span className="text-[10px] text-slate-500">{format(new Date(notif.timestamp), 'dd MMM HH:mm')}</span>
                  </div>
                  <p className="text-sm text-slate-400">{notif.message}</p>
                </div>
                {!notif.read && <div className="w-2 h-2 rounded-full bg-[#D4FF00] mt-2" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
