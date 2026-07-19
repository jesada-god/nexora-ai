import type {
  MarketDataApiError,
  MarketDataErrorCode,
} from '@/src/lib/market-data/types';

export type StockDetailErrorSection = 'market' | 'profile' | 'quote';

const GENERIC_MESSAGES: Record<StockDetailErrorSection, string> = {
  market: 'ข้อมูลสถานะตลาดไม่พร้อมใช้งานชั่วคราว',
  profile: 'ข้อมูลบริษัทไม่พร้อมใช้งานชั่วคราว',
  quote: 'ข้อมูลราคาไม่พร้อมใช้งานชั่วคราว',
};

const SECTION_NOUNS: Record<StockDetailErrorSection, string> = {
  market: 'สถานะตลาด',
  profile: 'ข้อมูลบริษัท',
  quote: 'ข้อมูลราคา',
};

export function stockDetailErrorMessage(
  error: Pick<MarketDataApiError, 'code'> | null,
  section: StockDetailErrorSection,
  providerConfigured = true,
): string {
  if (!error) {
    return providerConfigured
      ? GENERIC_MESSAGES[section]
      : 'ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูลตลาด';
  }

  const noun = SECTION_NOUNS[section];
  const messages: Partial<Record<MarketDataErrorCode, string>> = {
    'provider-not-configured': 'ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูลตลาด',
    'invalid-request': `คำขอ${noun}ไม่ถูกต้อง`,
    'invalid-symbol': 'สัญลักษณ์หลักทรัพย์ไม่ถูกต้อง',
    'not-found': `ไม่พบ${noun}สำหรับหลักทรัพย์นี้`,
    'rate-limited': 'ผู้ให้บริการข้อมูลถึงขีดจำกัดการเรียกใช้งาน กรุณาลองใหม่ภายหลัง',
    timeout: `การโหลด${noun}ใช้เวลานานเกินไป กรุณาลองใหม่ภายหลัง`,
    'provider-unauthorized': 'ไม่สามารถยืนยันสิทธิ์กับผู้ให้บริการข้อมูลได้',
    'upstream-unavailable': GENERIC_MESSAGES[section],
    'invalid-provider-response': `${noun}จากผู้ให้บริการไม่สมบูรณ์`,
    'insufficient-data': `มี${noun}ไม่เพียงพอสำหรับการแสดงผล`,
    'internal-error': GENERIC_MESSAGES[section],
  };
  return messages[error.code] ?? GENERIC_MESSAGES[section];
}

export function companyProfileErrorPresentation(
  error: Pick<MarketDataApiError, 'code'> | null,
): { title: string; detail: string } | null {
  if (!error) return null;
  return {
    title: 'ข้อมูลบริษัทไม่พร้อมใช้งานชั่วคราว',
    detail: stockDetailErrorMessage(error, 'profile'),
  };
}
