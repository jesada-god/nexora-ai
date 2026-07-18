import 'server-only';
import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.url().optional(),
);

const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const serverEnvSchema = z.object({
  APP_URL: optionalUrl,
  GEMINI_API_KEY: optionalSecret,
  ALPHA_VANTAGE_API_KEY: optionalSecret,
  NEWS_API_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
});

const parsedServerEnv = serverEnvSchema.safeParse({
  APP_URL: process.env.APP_URL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY,
  NEWS_API_KEY: process.env.NEWS_API_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

// Missing or invalid optional integrations must not crash the application.
export const serverEnv = parsedServerEnv.success
  ? parsedServerEnv.data
  : { APP_URL: undefined, GEMINI_API_KEY: undefined, ALPHA_VANTAGE_API_KEY: undefined, NEWS_API_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };

export const serverEnvIssues = parsedServerEnv.success
  ? []
  : parsedServerEnv.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
