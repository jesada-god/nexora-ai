import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { clientEnv } from '@/src/config/env/client';
import { serverEnv } from '@/src/config/env/server';
import type { Database } from '@/src/types/database';

export function createAdminClient() {
  if (!clientEnv.NEXT_PUBLIC_SUPABASE_URL || !serverEnv.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
