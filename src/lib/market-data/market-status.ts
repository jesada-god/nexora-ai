import { MarketDataError } from './errors';

export type MarketStatusUnavailableReason =
  | 'missing-config'
  | 'invalid-config'
  | 'rate-limit'
  | 'timeout'
  | 'upstream-error'
  | 'unknown';

export function marketStatusReasonFromError(
  cause: unknown,
): MarketStatusUnavailableReason {
  if (!(cause instanceof MarketDataError)) return 'unknown';
  if (cause.code === 'provider-not-configured') return 'missing-config';
  if (cause.code === 'provider-unauthorized') return 'invalid-config';
  if (cause.code === 'rate-limited') return 'rate-limit';
  if (cause.code === 'timeout') return 'timeout';
  if (
    cause.code === 'upstream-unavailable'
    || cause.code === 'invalid-provider-response'
  ) {
    return 'upstream-error';
  }
  return 'unknown';
}

export function marketStatusReasonMessage(
  reason: MarketStatusUnavailableReason,
): string {
  if (reason === 'missing-config') {
    return 'ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูลตลาด';
  }
  if (reason === 'invalid-config') {
    return 'การตั้งค่าผู้ให้บริการข้อมูลตลาดไม่ถูกต้อง';
  }
  if (reason === 'rate-limit') {
    return 'ผู้ให้บริการข้อมูลตลาดจำกัดจำนวนคำขอชั่วคราว';
  }
  if (reason === 'timeout') {
    return 'ผู้ให้บริการข้อมูลตลาดตอบช้าเกินไป';
  }
  if (reason === 'upstream-error') {
    return 'ผู้ให้บริการข้อมูลตลาดไม่พร้อมใช้งานชั่วคราว';
  }
  return 'ยังไม่สามารถระบุสถานะตลาดได้';
}
