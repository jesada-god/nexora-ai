import { z } from 'zod';

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsedClientEnv = clientEnvSchema.safeParse({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});

export const clientEnv = parsedClientEnv.success
  ? parsedClientEnv.data
  : clientEnvSchema.parse({ NEXT_PUBLIC_APP_ENV: 'development' });

export const clientEnvIssues = parsedClientEnv.success
  ? []
  : parsedClientEnv.error.issues.map((issue) => issue.message);
