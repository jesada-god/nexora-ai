'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineNotice() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const updateStatus = () => setIsOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div role="status" className="flex min-h-11 items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs font-medium text-amber-200">
      <WifiOff aria-hidden="true" size={16} />
      ออฟไลน์อยู่ — ข้อมูลที่แสดงอาจเป็นข้อมูลสาธิตหรือข้อมูลที่บันทึกไว้
    </div>
  );
}
