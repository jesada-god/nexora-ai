import { describe, expect, it, vi } from 'vitest';
import { CompanyProfileTranslationClient } from './company-profile-translation-client';

function response(text: string) {
  return new Response(JSON.stringify({
    data: {
      symbol: 'RKLB',
      sourceText: 'Rocket Lab provides launch services.',
      translatedText: text,
      targetLanguage: 'th',
      sourceHash: 'a'.repeat(64),
    },
    meta: {
      cached: false,
      timestamp: '2026-07-20T00:00:00.000Z',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const input = {
  symbol: 'RKLB',
  sourceText: 'Rocket Lab provides launch services.',
  targetLanguage: 'th' as const,
};

describe('Company Profile translation client', () => {
  it('reuses the same in-flight request across Strict Mode cleanup and setup', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => {
      resolve = done;
    }));
    const client = new CompanyProfileTranslationClient(fetcher);
    const firstController = new AbortController();
    const first = client.request(input, firstController.signal);
    firstController.abort();
    const second = client.request(input, new AbortController().signal);
    resolve(response('Rocket Lab ให้บริการด้านการปล่อยจรวด'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toBe('Rocket Lab ให้บริการด้านการปล่อยจรวด');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
