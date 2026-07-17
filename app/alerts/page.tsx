import { BellRing } from 'lucide-react';
import Header from '@/src/components/layout/Header';
import { EmptyState } from '@/src/components/ui/EmptyState';

export default function AlertsPage() {
  return (
    <div><Header title="การแจ้งเตือนราคา (Alerts)" subtitle="พื้นที่ส่วนตัวของบัญชีคุณ" /><div className="mx-auto max-w-3xl p-4 md:p-8"><EmptyState icon={BellRing} title="ยังไม่มีการแจ้งเตือนราคา" description="ระบบจัดเก็บ Alerts จริงจะเพิ่มใน Phase ถัดไป โดยหน้านี้ได้รับการป้องกันด้วย Supabase Auth แล้ว" /></div></div>
  );
}
