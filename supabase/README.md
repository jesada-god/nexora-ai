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

Use only the publishable/anon project key in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The browser application never uses a service-role key. The server-only `sync:instruments` CLI additionally requires `SUPABASE_SERVICE_ROLE_KEY` for a real (non-dry-run) sync.

The SQL migrations enable RLS on user-owned tables; policies compare each row to `auth.uid()`. Apply migrations in filename order. Phase 3 adds one default `watchlists` row per user and parent-owner policies for every `watchlist_items` operation. It also enforces unique `(watchlist_id, symbol)` values in the database.

Instrument Master is added by `202607180007_instrument_master.sql`. After applying it, preview the provider snapshot with `npm run sync:instruments -- --dry-run`, then run `npm run sync:instruments`. The server-side sync requests Alpha Vantage `LISTING_STATUS` first and automatically falls back to the Nasdaq Trader `nasdaqlisted.txt` and `otherlisted.txt` directories when the primary response is invalid or unavailable. If neither provider produces a complete snapshot, the run is reported as incomplete and nothing is staged or finalized. The sync uses a daily idempotency key, so it is safe to schedule once per day. Only the CLI/service role can stage or finalize sync data; browser roles have read-only access to `market_instruments`.

Persistent FX rates are added by `202607180008_market_fx_rates.sql`. Browser roles have no access to this table; only server code using `SUPABASE_SERVICE_ROLE_KEY` can read or upsert it. After applying the migration, run `npm run seed:fx` to fetch and persist the first real USD/THB rate. The command never inserts a fixed or mocked rate.
