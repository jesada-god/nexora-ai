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

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const cache = new SharedRequestCache();

const geminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional() })),
    }),
  })).min(1),
});

export type TranslationErrorCode =
  | 'invalid-request'
  | 'provider-not-configured'
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
        : code === 'provider-not-configured'
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
    .replace(/<[^>]*>/g, '')
    .replaceAll('\u0000', '')
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .slice(0, 8_000);
}

async function translateWithGemini(
  apiKey: string,
  input: CompanyProfileTranslationRequest,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: 'Translate only the supplied public company description into natural Thai. Preserve company names, product names, symbols, currencies, URLs, and numbers exactly. Return plain text only, without Markdown or commentary.',
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `Symbol: ${input.symbol}\nSource language: English\nTarget language: Thai\n\n<company_description>\n${input.sourceText}\n</company_description>`,
          }],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2_048,
        },
      }),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
  } catch {
    throw new CompanyProfileTranslationError(
      'upstream-unavailable',
      'Translation provider is temporarily unavailable',
    );
  }

  if (!response.ok) {
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
  const text = sanitizeTranslation(
    parsed.candidates[0]?.content.parts.map((part) => part.text ?? '').join('') ?? '',
  );
  if (!text) {
    throw new CompanyProfileTranslationError(
      'invalid-provider-response',
      'Translation provider returned an empty translation',
    );
  }
  return text;
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
        translatedText: sanitizeTranslation(await this.operation(input)),
      }),
      {
        freshMs: 30 * 24 * 60 * 60_000,
        staleMs: 90 * 24 * 60 * 60_000,
        errorMs: 30_000,
      },
    );
    return {
      data: result.value,
      cached: result.state !== 'fresh',
    };
  }
}

let configuredService: CompanyProfileTranslationService | null = null;
let configuredKey: string | undefined;

export function getCompanyProfileTranslationService(): CompanyProfileTranslationService {
  const apiKey = serverEnv.GEMINI_API_KEY;
  if (!apiKey) {
    throw new CompanyProfileTranslationError(
      'provider-not-configured',
      'Company Profile translation is not configured',
    );
  }
  if (!configuredService || configuredKey !== apiKey) {
    configuredKey = apiKey;
    configuredService = new CompanyProfileTranslationService(
      (input) => translateWithGemini(apiKey, input),
      cache,
    );
  }
  return configuredService;
}
