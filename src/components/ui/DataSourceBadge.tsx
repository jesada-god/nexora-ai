import { FlaskConical } from 'lucide-react';
import { demoDataInfo } from '@/src/mocks/marketData';

export function DataSourceBadge() {
  return (
    <span
      className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 text-[10px] font-semibold text-amber-300"
      title="ข้อมูลตัวอย่างสำหรับสาธิต ไม่ใช่ข้อมูลตลาดจริง"
    >
      <FlaskConical aria-hidden="true" size={12} />
      {demoDataInfo.label}
    </span>
  );
}
