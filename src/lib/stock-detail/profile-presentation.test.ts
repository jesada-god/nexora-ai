import { describe, expect, it } from 'vitest';
import {
  displayCountry,
  displayFiscalYearEnd,
  formatMarketCapitalization,
  isCompanyProfileTranslationLoading,
  resolvedDescription,
  shouldRequestCompanyProfileTranslation,
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

  it('requests translation only for Thai when English source text exists', () => {
    expect(shouldRequestCompanyProfileTranslation('th', 'Rocket Lab provides launch services.')).toBe(true);
    expect(shouldRequestCompanyProfileTranslation('en', 'Rocket Lab provides launch services.')).toBe(false);
    expect(shouldRequestCompanyProfileTranslation('th', null)).toBe(false);
    expect(shouldRequestCompanyProfileTranslation('th', '   ')).toBe(false);
  });

  it('leaves loading and falls back after the active translation attempt fails', () => {
    expect(isCompanyProfileTranslationLoading({
      language: 'th',
      sourceText: 'Rocket Lab provides launch services.',
      attempt: 1,
      settledAttempt: 1,
      translatedText: null,
      error: 'Translation request timed out',
    })).toBe(false);
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
});
