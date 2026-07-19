import { describe, expect, it } from 'vitest';
import {
  displayCountry,
  displayFiscalYearEnd,
  formatMarketCapitalization,
  resolvedDescription,
} from './profile-presentation';
import { companyProfileTranslationRequestSchema } from './api-schemas';

describe('Company Profile presentation', () => {
  it('keeps the original English source when translation fails', () => {
    expect(resolvedDescription({
      language: 'th',
      sourceText: 'Rocket Lab provides launch services.',
      translatedText: null,
      translationFailed: true,
    })).toEqual({
      text: 'Rocket Lab provides launch services.',
      fellBackToEnglish: true,
    });
  });

  it('does not translate symbols, currency, or source numeric values', () => {
    expect(formatMarketCapitalization(42_000_000_000, 'USD')).toBe('$42.0B');
    expect(displayCountry('USA', 'en')).toBe('USA');
    expect(displayFiscalYearEnd('December', 'en')).toBe('December');
    expect(companyProfileTranslationRequestSchema.safeParse({
      symbol: 'RKLB',
      sourceText: 'Rocket Lab provides launch services.',
      targetLanguage: 'th',
      companyName: 'Rocket Lab USA, Inc.',
      currency: 'USD',
    }).success).toBe(false);
  });

  it('localizes only display values for Thai', () => {
    expect(displayCountry('USA', 'th')).toContain('สหรัฐ');
    expect(displayFiscalYearEnd('December', 'th')).toBe('ธันวาคม');
  });
});
