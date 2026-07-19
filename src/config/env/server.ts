import 'server-only';
import { z } from 'zod';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.url().optional(),
);

const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const geminiModel = z.preprocess(
  (value) => typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_GEMINI_MODEL,
  z.string().min(1),
);

const serverEnvSchema = z.object({
  APP_URL: optionalUrl,
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: geminiModel,
  ALPHA_VANTAGE_API_KEY: optionalSecret,
  FMP_API_KEY: optionalSecret,
  NEWS_API_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  CRON_SECRET: optionalSecret,
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalSecret,
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalSecret,
  WEB_PUSH_SUBJECT: z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional()),
});

const parsedServerEnv = serverEnvSchema.safeParse({
  APP_URL: process.env.APP_URL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY,
  FMP_API_KEY: process.env.FMP_API_KEY,
  NEWS_API_KEY: process.env.NEWS_API_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  WEB_PUSH_VAPID_PUBLIC_KEY: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  WEB_PUSH_VAPID_PRIVATE_KEY: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  WEB_PUSH_SUBJECT: process.env.WEB_PUSH_SUBJECT,
});

// Missing or invalid optional integrations must not crash the application.
export const serverEnv = parsedServerEnv.success
  ? parsedServerEnv.data
  : { APP_URL: undefined, GEMINI_API_KEY: undefined, GEMINI_MODEL: DEFAULT_GEMINI_MODEL, ALPHA_VANTAGE_API_KEY: undefined, FMP_API_KEY: undefined, NEWS_API_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, CRON_SECRET: undefined, WEB_PUSH_VAPID_PUBLIC_KEY: undefined, WEB_PUSH_VAPID_PRIVATE_KEY: undefined, WEB_PUSH_SUBJECT: undefined };

export const serverEnvIssues = parsedServerEnv.success
  ? []
  : parsedServerEnv.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
