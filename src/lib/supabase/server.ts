import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { clientEnv, isSupabaseConfigured } from '@/src/config/env/client';
import type { Database } from '@/src/types/database';

export async function createClient(): Promise<SupabaseClient<Database> | null> {
  if (!isSupabaseConfigured) return null;

  const cookieStore = await cookies();
  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL as string,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot write cookies; middleware refreshes them.
          }
        },
      },
    },
  );
}
