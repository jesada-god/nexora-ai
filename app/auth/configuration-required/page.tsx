import { AuthCard } from '@/src/components/auth/AuthCard';
import { ConfigurationRequired } from '@/src/components/auth/ConfigurationRequired';

export default function ConfigurationRequiredPage() {
  return <AuthCard title="Authentication ยังไม่พร้อม" description="แอปยัง build และเปิดหน้าตลาดสาธารณะได้ตามปกติ"><ConfigurationRequired /></AuthCard>;
}
