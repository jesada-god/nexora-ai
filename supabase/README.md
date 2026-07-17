# Supabase Phase 1 setup

1. Create or select a Supabase project.
2. Run `migrations/202607180001_phase_1_auth.sql` in the Supabase SQL editor or through your normal migration pipeline.
3. Copy `.env.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `APP_URL` for the deployed site (recommended for future server integrations)
4. In Authentication URL Configuration, add these redirect URLs for each environment:
   - `<APP_URL>/auth/callback`
   - `<APP_URL>/auth/callback?next=/auth/reset-password`
5. Restart the Next.js server after changing environment variables.

Use only the publishable/anon project key in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. A Service Role key is neither required nor used by this application.

The SQL migration enables RLS on `profiles` and `user_settings`; policies compare each row to `auth.uid()`. It also exposes `delete_own_account()` only to authenticated users, and that function can delete only the caller's own `auth.users` row.
