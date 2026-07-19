import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { serverEnv } from '@/src/config/env/server';
import { SharedRequestCache } from '@/src/lib/shared-request-cache';
import {
  companyProfileTranslationDataSchema,
  companyProfileTranslationRequestSchema,
  type CompanyProfileTranslationRequest,
} from '@/src/lib/stock-detail/api-schemas';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 12_000;
const cache = new SharedRequestCache();

const geminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
}).passthrough();

const TRANSLATION_INSTRUCTIONS = [
  'Translate the supplied Company Profile from English into Thai.',
  'Return only the Thai translation.',
  'Use clear, fluent, natural language that general readers can understand.',
  'Avoid difficult technical terms. When a technical term is necessary, use a simple Thai equivalent or explain it briefly within the sentence.',
  'Preserve the complete original meaning. Do not summarize, omit information, or add new information.',
  'Keep the company name, Symbol, product names, service names, and other proper names exactly as written in the source.',
  'Do not use Markdown.',
  'Do not include headings, introductions, notes, explanations, or multiple translation options.',
  'Do not begin with phrases such as "คำแปลคือ", "สามารถแปลได้ดังนี้", "The translation is", "Here is the translation", or anything similar.',
].join('\n');

const EXPLANATION_PREFIX = /^(?:คำแปล(?:ภาษาไทย)?(?:คือ|:|：)|สามารถแปล(?:ได้)?(?:ว่า|ดังนี้)|แปล(?:ได้)?ดังนี้|นี่คือคำแปล|ต่อไปนี้(?:คือ|เป็น)คำแปล|หมายเหตุ\s*[:：]|คำอธิบาย\s*[:：]|the translation(?: is|:)|translation:|here(?:'s| is) the translation|note\s*:|explanation\s*:|sure(?:[,!:]|\s+-))/i;
const MULTIPLE_OPTIONS = /(?:^|\n)\s*(?:ตัวเลือก(?:ที่)?|คำแปล(?:แบบ)?ที่|option)\s*[1-9]\b/giu;

type GeminiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GeminiTranslationOptions {
  apiKey: string;
  model: string;
  input: CompanyProfileTranslationRequest;
  fetchImpl?: GeminiFetch;
}

export type TranslationErrorCode =
  | 'invalid-request'
  | 'provider-not-configured'
  | 'model-unavailable'
  | 'rate-limited'
  | 'upstream-unavailable'
  | 'invalid-provider-response';

export class CompanyProfileTranslationError extends Error {
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    readonly code: TranslationErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'CompanyProfileTranslationError';
    this.retryable = code === 'rate-limited' || code === 'upstream-unavailable';
    this.status = code === 'invalid-request'
      ? 400
      : code === 'rate-limited'
        ? 429
        : code === 'provider-not-configured' || code === 'model-unavailable'
          ? 503
          : 502;
  }
}

type TranslationOperation = (input: CompanyProfileTranslationRequest) => Promise<string>;

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

export function sanitizeTranslation(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .trim()
    .replace(/^```(?:text|plaintext|markdown)?[ \t]*(?:\r?\n)?/i, '')
    .replace(/(?:\r?\n)?[ \t]*```$/i, '')
    .replaceAll('```', '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 8_000);
}

export function maxOutputTokensForSource(sourceText: string): number {
  return Math.min(8_000, Math.max(256, Math.ceil(sourceText.length * 1.5)));
}

export function validateTranslationOutput(value: string): string {
  const text = sanitizeTranslation(value);
  if (!text) {
    throw new CompanyProfileTranslationError(
      'invalid-provider-response',
      'Translation provider returned an empty translation',
    );
  }

  const normalizedLead = text
    .slice(0, 160)
    .replace(/^[\s#>*_-]+/, '')
    .replaceAll('**', '')
    .trim();
  const optionMarkers = Array.from(text.matchAll(MULTIPLE_OPTIONS));
  const hasMarkdown = /(?:^|\n)\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)|\*\*[^*\n]+\*\*|__[^_\n]+__/m.test(text);
  if (
    EXPLANATION_PREFIX.test(normalizedLead)
    || optionMarkers.length > 0
    || hasMarkdown
    || !/[\u0E00-\u0E7F]/u.test(text)
  ) {
    throw new CompanyProfileTranslationError(
      'invalid-provider-response',
      'Translation provider returned commentary instead of a Thai translation',
    );
  }
  return text;
}

export async function translateWithGemini({
  apiKey,
  model,
  input,
  fetchImpl = fetch,
}: GeminiTranslationOptions): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: TRANSLATION_INSTRUCTIONS,
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `Symbol: ${input.symbol}\nSource language: English\nTarget language: Thai\n\n<company_description>\n${input.sourceText}\n</company_description>`,
          }],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: maxOutputTokensForSource(input.sourceText),
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new CompanyProfileTranslationError(
      'upstream-unavailable',
      'Translation provider is temporarily unavailable',
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new CompanyProfileTranslationError(
        'model-unavailable',
        'Configured translation model is unavailable',
      );
    }
    if (response.status === 429) {
      throw new CompanyProfileTranslationError(
        'rate-limited',
        'Translation provider rate limit exceeded',
        retryAfterSeconds(response),
      );
    }
    throw new CompanyProfileTranslationError(
      'upstream-unavailable',
      'Translation provider rejected the request',
    );
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new CompanyProfileTranslationError(
      'invalid-provider-response',
      'Translation provider returned a non-JSON response',
    );
  }

  let parsed: z.infer<typeof geminiResponseSchema>;
  try {
    parsed = geminiResponseSchema.parse(await response.json());
  } catch {
    throw new CompanyProfileTranslationError(
      'invalid-provider-response',
      'Translation provider returned an invalid response',
    );
  }
  return validateTranslationOutput(
    parsed.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('') ?? '',
  );
}

export class CompanyProfileTranslationService {
  constructor(
    private readonly operation: TranslationOperation,
    private readonly requestCache = new SharedRequestCache(),
  ) {}

  async translate(rawInput: unknown) {
    const input = companyProfileTranslationRequestSchema.parse(rawInput);
    const sourceHash = createHash('sha256').update(input.sourceText, 'utf8').digest('hex');
    const key = `company-profile-translation:${input.symbol}:${input.targetLanguage}:${sourceHash}`;
    const result = await this.requestCache.resolve(
      key,
      async () => companyProfileTranslationDataSchema.parse({
        ...input,
        sourceHash,
        translatedText: validateTranslationOutput(await this.operation(input)),
      }),
      {
        freshMs: 30 * 24 * 60 * 60_000,
        staleMs: 90 * 24 * 60 * 60_000,
        errorMs: 0,
      },
    );
    return {
      data: result.value,
      cached: result.state !== 'fresh',
    };
  }
}

let configuredService: CompanyProfileTranslationService | null = null;
let configuredIdentity: string | undefined;

export function getCompanyProfileTranslationService(): CompanyProfileTranslationService {
  const apiKey = serverEnv.GEMINI_API_KEY;
  const model = serverEnv.GEMINI_MODEL;
  if (!apiKey) {
    throw new CompanyProfileTranslationError(
      'provider-not-configured',
      'Company Profile translation is not configured',
    );
  }
  const identity = `${apiKey}:${model}`;
  if (!configuredService || configuredIdentity !== identity) {
    configuredIdentity = identity;
    configuredService = new CompanyProfileTranslationService(
      (input) => translateWithGemini({ apiKey, model, input }),
      cache,
    );
  }
  return configuredService;
}
