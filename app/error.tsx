'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error', error);
  }, [error]);

  return (
    <div role="alert" className="min-h-[60dvh] p-6 flex flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
        <AlertTriangle aria-hidden="true" size={24} />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-white">ไม่สามารถแสดงหน้านี้ได้</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">เกิดข้อผิดพลาดชั่วคราว ข้อมูลของคุณยังไม่ถูกลบ กรุณาลองอีกครั้ง</p>
      <Button className="mt-6" onClick={reset}>
        <RotateCcw aria-hidden="true" size={16} className="mr-2" /> ลองอีกครั้ง
      </Button>
    </div>
  );
}
