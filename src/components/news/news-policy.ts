export function shouldRenderNewsImage(saveData: boolean, imageUrl: string | null) { return !saveData && Boolean(imageUrl); }
export function newsErrorMessage(code: string) {
  if (code === 'configuration-required') return 'ต้องตั้งค่า NEWS_API_KEY ก่อนใช้งานข่าว';
  if (code === 'rate-limited') return 'โควตาข่าวเต็ม กรุณารอสักครู่แล้วลองใหม่';
  if (code === 'timeout') return 'ผู้ให้บริการข่าวตอบช้าเกินไป';
  if (code === 'invalid-key') return 'การตั้งค่าผู้ให้บริการข่าวไม่ถูกต้อง';
  return 'ข่าวไม่พร้อมใช้งานชั่วคราว';
}
export type NewsViewState = 'loading' | 'empty' | 'configuration-required' | 'rate-limited' | 'error' | 'ready';
export function newsViewState(itemCount: number, loading: boolean, errorCode?: string): NewsViewState {
  if (loading && itemCount === 0) return 'loading';
  if (itemCount > 0) return 'ready';
  if (errorCode === 'configuration-required') return 'configuration-required';
  if (errorCode === 'rate-limited') return 'rate-limited';
  if (errorCode) return 'error';
  return 'empty';
}
