export function shouldRenderNewsImage(saveData: boolean, imageUrl: string | null) { return !saveData && Boolean(imageUrl); }
export function newsErrorMessage(code: string) {
  if (code === 'NEWS_PROVIDER_NOT_CONFIGURED') return 'ยังไม่สามารถโหลดข่าวได้ — ระบบข่าวยังไม่ได้ตั้งค่า';
  if (code === 'NEWS_PROVIDER_RATE_LIMITED') return 'ยังไม่สามารถโหลดข่าวได้ — ผู้ให้บริการจำกัดจำนวนคำขอชั่วคราว';
  if (code === 'NEWS_PROVIDER_TIMEOUT') return 'ยังไม่สามารถโหลดข่าวได้ — ผู้ให้บริการตอบช้าเกินไป';
  if (code === 'NEWS_PROVIDER_INVALID_KEY') return 'ยังไม่สามารถโหลดข่าวได้ — การตั้งค่าผู้ให้บริการไม่ถูกต้อง';
  return 'ยังไม่สามารถโหลดข่าวได้ — ผู้ให้บริการไม่พร้อมใช้งานชั่วคราว';
}
export type NewsViewState = 'loading' | 'empty' | 'configuration-required' | 'rate-limited' | 'error' | 'ready';
export function newsViewState(itemCount: number, loading: boolean, errorCode?: string): NewsViewState {
  if (loading && itemCount === 0) return 'loading';
  if (itemCount > 0) return 'ready';
  if (errorCode === 'NEWS_PROVIDER_NOT_CONFIGURED') return 'configuration-required';
  if (errorCode === 'NEWS_PROVIDER_RATE_LIMITED') return 'rate-limited';
  if (errorCode) return 'error';
  return 'empty';
}
