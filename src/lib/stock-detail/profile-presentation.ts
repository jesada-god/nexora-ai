export type CompanyProfileLanguage = 'th' | 'en';

const THAI_MONTHS: Record<string, string> = {
  January: 'มกราคม',
  February: 'กุมภาพันธ์',
  March: 'มีนาคม',
  April: 'เมษายน',
  May: 'พฤษภาคม',
  June: 'มิถุนายน',
  July: 'กรกฎาคม',
  August: 'สิงหาคม',
  September: 'กันยายน',
  October: 'ตุลาคม',
  November: 'พฤศจิกายน',
  December: 'ธันวาคม',
};

const COUNTRY_CODES: Record<string, string> = {
  USA: 'US',
  'United States': 'US',
  'United States of America': 'US',
  Thailand: 'TH',
  Canada: 'CA',
  China: 'CN',
  Japan: 'JP',
  Singapore: 'SG',
  'United Kingdom': 'GB',
};

export const companyProfileLabels = {
  th: {
    title: 'ข้อมูลบริษัท',
    country: 'ประเทศ',
    employees: 'จำนวนพนักงาน',
    currency: 'สกุลเงิน',
    fiscalYearEnd: 'สิ้นสุดปีบัญชี',
    website: 'เยี่ยมชมเว็บไซต์บริษัท',
    unavailable: 'ไม่พร้อมใช้งาน',
    missingDescription: 'ยังไม่มีรายละเอียดบริษัทสำหรับแปล',
    unknownProvider: 'ไม่ทราบผู้ให้บริการ',
    loading: 'กำลังโหลด…',
    retryWait: 'รอตามระยะเวลาที่กำหนดแล้วลองอีกครั้ง',
    retryProfile: 'ลองโหลดข้อมูลบริษัทอีกครั้ง',
    loadingTranslation: 'กำลังโหลดคำแปล…',
    translationFailed: 'ไม่สามารถโหลดคำแปลได้ กำลังแสดงข้อความภาษาอังกฤษต้นฉบับ',
    retryTranslation: 'ลองแปลอีกครั้ง',
  },
  en: {
    title: 'Company Profile',
    country: 'Country',
    employees: 'Employees',
    currency: 'Currency',
    fiscalYearEnd: 'Fiscal year end',
    website: 'Visit company website',
    unavailable: 'Unavailable',
    missingDescription: 'ยังไม่มีรายละเอียดบริษัทสำหรับแปล',
    unknownProvider: 'Unknown provider',
    loading: 'Loading…',
    retryWait: 'Wait for the retry period, then try again',
    retryProfile: 'Retry company profile',
    loadingTranslation: 'Loading translation…',
    translationFailed: 'Translation is unavailable. Showing the original English text.',
    retryTranslation: 'Retry translation',
  },
} as const;

export function shouldRequestCompanyProfileTranslation(
  language: CompanyProfileLanguage,
  sourceText: string | null,
): sourceText is string {
  return language === 'th' && Boolean(sourceText?.trim());
}

export function displayCountry(source: string | null, language: CompanyProfileLanguage): string | null {
  if (!source || language === 'en') return source;
  const code = COUNTRY_CODES[source];
  if (!code) return source;
  return new Intl.DisplayNames(['th'], { type: 'region' }).of(code) ?? source;
}

export function displayFiscalYearEnd(source: string | null, language: CompanyProfileLanguage): string | null {
  if (!source || language === 'en') return source;
  return THAI_MONTHS[source] ?? source;
}

export function formatMarketCapitalization(value: number | null, currency: string | null): string | null {
  if (value === null || !Number.isFinite(value) || !currency) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return null;
  }
}

export function resolvedDescription(input: {
  language: CompanyProfileLanguage;
  sourceText: string | null;
  translatedText: string | null;
  translationFailed: boolean;
}): { text: string | null; fellBackToEnglish: boolean } {
  if (input.language === 'en') {
    return { text: input.sourceText, fellBackToEnglish: false };
  }
  if (input.translatedText) {
    return { text: input.translatedText, fellBackToEnglish: false };
  }
  return {
    text: input.sourceText,
    fellBackToEnglish: input.translationFailed && Boolean(input.sourceText),
  };
}
