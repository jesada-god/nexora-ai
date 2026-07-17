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

The SQL migrations enable RLS on user-owned tables; policies compare each row to `auth.uid()`. Apply migrations in filename order. Phase 3 adds one default `watchlists` row per user and parent-owner policies for every `watchlist_items` operation. It also enforces unique `(watchlist_id, symbol)` values in the database.
