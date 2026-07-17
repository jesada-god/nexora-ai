'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clientEnv, isSupabaseConfigured } from '@/src/config/env/client';
import type { Database } from '@/src/types/database';

let browserClient: SupabaseClient<Database> | null = null;

export function createClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (browserClient) return browserClient;

  browserClient = createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL as string,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  return browserClient;
}
