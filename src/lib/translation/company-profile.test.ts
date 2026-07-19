import { describe, expect, it, vi } from 'vitest';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import {
  CompanyProfileTranslationService,
  sanitizeTranslation,
} from './company-profile';

vi.mock('server-only', () => ({}));

const input = {
  symbol: 'RKLB',
  sourceText: 'Rocket Lab provides launch services.',
  targetLanguage: 'th' as const,
};

describe('Company Profile translation', () => {
  it('sanitizes markup and control bytes from provider output', () => {
    expect(sanitizeTranslation('```text\n<b>บริการ\u0000อวกาศ</b>\n```')).toBe('บริการอวกาศ');
  });

  it('caches by symbol, target language, and source hash', async () => {
    const operation = vi.fn(async () => 'Rocket Lab ให้บริการด้านการปล่อยจรวด');
    const service = new CompanyProfileTranslationService(operation, new SharedRequestCache());
    const first = await service.translate(input);
    const second = await service.translate(input);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(first.data.sourceText).toBe(input.sourceText);
    expect(first.data.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a translation when the provider fails', async () => {
    const service = new CompanyProfileTranslationService(
      vi.fn(async () => {
        throw new Error('provider failed');
      }),
      new SharedRequestCache(),
    );
    await expect(service.translate(input)).rejects.toThrow('provider failed');
  });
});
