'use client';

import Header from '@/src/components/layout/Header';
import { Button } from '@/src/components/ui/Button';
import { PriceTargetWorkspace } from '@/src/components/price-target/PriceTargetWorkspace';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function PriceTargetPage() {
  const router = useRouter();

  return (
    <div className="min-w-0">
      <Header title="วิเคราะห์ราคาเป้าหมายหุ้น" />
      <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-8 md:pt-8">
        <Button variant="ghost" className="min-h-11 px-2" onClick={() => router.back()}>
          <ArrowLeft size={18} className="mr-2" aria-hidden="true" /> กลับไปหน้าเครื่องมือ
        </Button>
      </div>
      <PriceTargetWorkspace />
    </div>
  );
}
