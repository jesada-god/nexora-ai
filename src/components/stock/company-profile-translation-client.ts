'use client';

import {
  companyProfileTranslationResponseSchema,
  type CompanyProfileTranslationRequest,
} from '@/src/lib/stock-detail/api-schemas';

type TranslationFetcher = (
  url: string,
  init: {
    method: 'POST';
    headers: { Accept: string; 'Content-Type': string };
    body: string;
    signal: AbortSignal;
  },
) => Promise<Response>;

interface InflightEntry {
  controller: AbortController;
  promise: Promise<string>;
  consumers: Set<symbol>;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class CompanyProfileTranslationClient {
  private readonly inflight = new Map<string, InflightEntry>();
  private readonly completed = new Map<string, string>();

  constructor(private readonly fetcher: TranslationFetcher) {}

  async request(input: CompanyProfileTranslationRequest, signal: AbortSignal): Promise<string> {
    const sourceHash = await sha256(input.sourceText);
    const key = `${input.symbol}:${input.targetLanguage}:${sourceHash}`;
    if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');

    const completed = this.completed.get(key);
    if (completed) return completed;

    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = this.fetcher('/api/translate/company-profile', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      }).then(async (response) => {
        const parsed = companyProfileTranslationResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error('Translation API returned an invalid response');
        if (!response.ok || !parsed.data.data) {
          throw new Error(parsed.data.error?.message ?? 'Translation is unavailable');
        }
        return parsed.data.data.translatedText;
      }).then((text) => {
        this.completed.set(key, text);
        return text;
      }).finally(() => this.inflight.delete(key));
      entry = { controller, promise, consumers: new Set() };
      this.inflight.set(key, entry);
    }

    const activeEntry = entry;
    const consumer = Symbol(key);
    activeEntry.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        activeEntry.consumers.delete(consumer);
        queueMicrotask(() => {
          if (activeEntry.consumers.size === 0 && this.inflight.get(key) === activeEntry) {
            activeEntry.controller.abort();
          }
        });
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        release();
        reject(new DOMException('Request aborted', 'AbortError'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void activeEntry.promise.then(
        (text) => {
          if (!settled) {
            settled = true;
            signal.removeEventListener('abort', abort);
            release();
            resolve(text);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            signal.removeEventListener('abort', abort);
            release();
            reject(error);
          }
        },
      );
    });
  }
}

export const companyProfileTranslationClient = new CompanyProfileTranslationClient(
  (url, init) => fetch(url, init),
);
