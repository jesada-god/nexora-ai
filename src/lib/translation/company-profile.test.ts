import { describe, expect, it, vi } from 'vitest';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import {
  CompanyProfileTranslationError,
  CompanyProfileTranslationService,
  maxOutputTokensForSource,
  sanitizeTranslation,
  translateWithGemini,
  validateTranslationOutput,
} from './company-profile';

vi.mock('server-only', () => ({}));

const input = {
  symbol: 'RKLB',
  sourceText: 'Rocket Lab provides launch services.',
  targetLanguage: 'th' as const,
};

function geminiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function translate(fetchImpl: typeof fetch) {
  return translateWithGemini({
    apiKey: 'test-key',
    model: 'configured-model',
    input,
    fetchImpl,
  });
}

describe('Company Profile translation', () => {
  it('sanitizes markup and control bytes from provider output', () => {
    expect(sanitizeTranslation('```text\n<b>บริการ\u0000อวกาศ</b>\n```')).toBe('บริการอวกาศ');
  });

  it('returns a successful Thai translation from all text parts', async () => {
    const fetchImpl = vi.fn(async (
      _request: string | URL | Request,
      _init?: RequestInit,
    ) => geminiResponse({
      candidates: [{
        content: {
          parts: [
            { text: 'Rocket Lab ให้บริการด้าน' },
            { text: 'การปล่อยจรวด' },
          ],
        },
      }],
    }));

    await expect(translate(fetchImpl)).resolves.toBe(
      'Rocket Lab ให้บริการด้านการปล่อยจรวด',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/configured-model:generateContent');
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody.generationConfig).toEqual({
      temperature: 0,
      maxOutputTokens: maxOutputTokensForSource(input.sourceText),
    });
    expect(requestBody.systemInstruction.parts[0].text).toContain('Return only the Thai translation.');
  });

  it('maps a provider 404 to model-unavailable', async () => {
    const promise = translate(vi.fn(async () => geminiResponse({}, 404)));

    await expect(promise).rejects.toMatchObject({
      code: 'model-unavailable',
      retryable: false,
      status: 503,
    });
  });

  it('rejects empty candidates safely', async () => {
    await expect(translate(vi.fn(async () => geminiResponse({
      candidates: [],
    })))).rejects.toMatchObject({
      code: 'invalid-provider-response',
    });
  });

  it('removes Markdown code fences from an otherwise valid translation', async () => {
    await expect(translate(vi.fn(async () => geminiResponse({
      candidates: [{
        content: {
          parts: [{ text: '```text\nRocket Lab ให้บริการปล่อยจรวด\n```' }],
        },
      }],
    })))).resolves.toBe('Rocket Lab ให้บริการปล่อยจรวด');
  });

  it('rejects explanatory text instead of accepting it as a translation', () => {
    expect(() => validateTranslationOutput(
      'หมายเหตุ: คำแปลที่เหมาะสมคือ Rocket Lab ให้บริการปล่อยจรวด',
    )).toThrow(CompanyProfileTranslationError);
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

  it('does not cache failures and retries only on the next explicit call', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockResolvedValueOnce('Rocket Lab ให้บริการปล่อยจรวด');
    const service = new CompanyProfileTranslationService(
      operation,
      new SharedRequestCache(),
    );

    await expect(service.translate(input)).rejects.toThrow('provider failed');
    expect(operation).toHaveBeenCalledTimes(1);
    await expect(service.translate(input)).resolves.toMatchObject({
      data: { translatedText: 'Rocket Lab ให้บริการปล่อยจรวด' },
      cached: false,
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not call Gemini when no source description is supplied', async () => {
    const operation = vi.fn(async () => 'unexpected');
    const service = new CompanyProfileTranslationService(
      operation,
      new SharedRequestCache(),
    );

    await expect(service.translate({
      symbol: 'RKLB',
      sourceText: '   ',
      targetLanguage: 'th',
    })).rejects.toBeDefined();
    expect(operation).not.toHaveBeenCalled();
  });
});
