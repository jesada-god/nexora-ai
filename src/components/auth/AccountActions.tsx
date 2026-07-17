'use client';

import { useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Modal } from '@/src/components/ui/Modal';
import { deleteAccountAction, signOutAction } from '@/app/auth/actions';

export function AccountActions() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <div className="space-y-3">
      <form action={signOutAction}><Button type="submit" variant="outline" className="w-full"><LogOut aria-hidden="true" size={16} className="mr-2" />ออกจากระบบ</Button></form>
      <Button type="button" variant="danger" className="w-full" onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden="true" size={16} className="mr-2" />ลบบัญชี</Button>
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="ยืนยันการลบบัญชี">
        <p className="text-sm leading-6 text-slate-300">การดำเนินการนี้ลบบัญชี โปรไฟล์ และการตั้งค่าถาวร ไม่สามารถย้อนกลับได้</p>
        <form action={deleteAccountAction} className="mt-4 space-y-4">
          <div><label htmlFor="confirmation" className="mb-1.5 block text-sm text-slate-300">พิมพ์ DELETE เพื่อยืนยัน</label><Input id="confirmation" name="confirmation" autoComplete="off" pattern="DELETE" required /></div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>ยกเลิก</Button><Button type="submit" variant="danger">ลบบัญชีถาวร</Button></div>
        </form>
      </Modal>
    </div>
  );
}
