# Vidya cloud AI module

This folder is the optional production backend for the GitHub Pages app. It keeps
the Gemini key off the public website and adds authenticated AI, usage records,
stored briefs and scheduled background work.

## Included

- `functions/vidya-ai/index.ts` — one authenticated Edge Function for Coach,
  visual understanding, briefs, schedules, health checks and usage summaries.
- `migrations/20260826000100_vidya_ai.sql` — private per-user tables, indexes,
  row-level security and the daily cost view.
- `migrations/20260826000200_vidya_cron.sql` — Supabase Cron, Vault and `pg_net`
  wiring for daily briefs and five-hour research refreshes.
- `.env.example` — names only; real secrets must never be committed.

Start with `../Documentation/CLOUD-AI-SETUP.md`. The browser integration contract
is in `../Documentation/VIDYA-AI-API-CONTRACT.md`.

## Security model

The personal beta accepts a random `x-vidya-owner-token` that is stored only in
Vidya's encrypted local vault and as a Supabase Edge Function secret. Requests
are also restricted to exact website origins. Supabase Auth JWTs are already
accepted for the later login/multi-user upgrade. Cron has a different secret.

`verify_jwt` is deliberately disabled at the gateway because the beta token and
Cron secret are not Supabase JWTs. Authentication is mandatory inside
`index.ts`; do not remove those checks or change CORS to `*`.

