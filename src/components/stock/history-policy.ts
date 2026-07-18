export function canLoadHistory(active: boolean, visibility: DocumentVisibilityState) { return active && visibility !== 'hidden'; }
export function historyErrorMessage(code?: string) {
  if (code === 'rate-limited') return 'โควตาข้อมูลตลาดเต็ม กรุณารอสักครู่แล้วลองใหม่';
  if (code === 'timeout') return 'ผู้ให้บริการตอบช้าเกินไป กรุณาลองใหม่';
  if (code === 'not-found' || code === 'invalid-symbol') return 'ไม่พบสัญลักษณ์หรือข้อมูลในช่วงนี้';
  if (code === 'provider-unauthorized') return 'การตั้งค่าผู้ให้บริการข้อมูลตลาดไม่ถูกต้อง';
  if (code === 'provider-not-configured') return 'ต้องตั้งค่า Market Data Provider ก่อนใช้งาน';
  return 'ข้อมูลกราฟไม่พร้อมใช้งานชั่วคราว';
}
