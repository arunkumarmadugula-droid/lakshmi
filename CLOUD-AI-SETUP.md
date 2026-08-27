# Make Vidya intelligent and scheduled

This is the shortest secure production path for the personal beta: one Supabase
project and one Google Gemini API key. GitHub Pages hosts the screen; Supabase
runs the private server code and schedules; Gemini supplies the intelligence.

## What works with and without cloud AI

Without an API, Vidya can still keep encrypted local tasks and Library records,
search local text, run the planner, export backups, accept browser speech and use
the bundled demonstration content. It cannot create genuinely intelligent
answers, understand an image, research the current web, or run while the browser
is closed.

With this module enabled, Coach, selected Library excerpts, visual analysis,
current research, cost records and stored/scheduled briefs use Gemini through a
Supabase Edge Function. The Gemini key is never sent to the browser or GitHub.

## Before you start

You need:

1. The GitHub Pages address where Vidya is deployed.
2. A Google account.
3. A free Supabase account.
4. Node.js 20 or newer on the Windows PC. Run `node --version` to check.

Use a computer for the one-time setup. Testing the finished app can then happen
on iPhone or iPad.

## 1. Acquire the Gemini API key

1. Open [Google AI Studio API keys](https://aistudio.google.com/app/apikey).
2. Sign in and accept the Gemini API terms if asked.
3. Click **Create API key**.
4. Choose a dedicated Google Cloud project, or create one named `Vidya Personal`.
5. Copy the key once and keep it in a password manager. Do not paste it into
   `config.js`, GitHub, browser storage or a screenshot.
6. Vidya routes routine Coach work to `gemini-3.5-flash-lite` and routes briefs,
   visual interpretation and grounded research to `gemini-3.7-flash`. This gives
   routine work the cheaper model while preserving quality for harder synthesis.
   Confirm model availability and rates on the live
   [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) page.

The free tier is fine for initial testing. A paid Google Cloud billing account is
preferable for private work because paid API data is not used to improve Google
products under the pricing table's terms, and it avoids a hard free-tier stop.
Set a small Google Cloud budget alert before heavy use.

## 2. Create the Supabase project

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) and sign in.
2. Click **New project**.
3. Select or create an organization.
4. Fill these fields:
   - **Name:** `vidya-personal`
   - **Database password:** generate a long password and save it in a password
     manager. This is not the Vidya login password.
   - **Region:** choose the region closest to you.
5. Click **Create new project** and wait until provisioning finishes.
6. In the project URL, copy the short project reference after `/project/`. It is
   also shown in **Project Settings → General**.

### Create the owner identity

The owner token needs one Supabase user UUID so usage, briefs and schedules have
a real private owner.

1. In the left sidebar click **Authentication → Users**.
2. Click **Add user → Send invitation**.
3. Enter your email and click **Invite user**.
4. Complete the link in the email.
5. Return to **Authentication → Users**, open your row and copy the **User UID**.

This does not yet replace Vidya's local password screen. It supplies the secure
database owner. A later upgrade can use the same Supabase user for login and JWT
authentication.

### Create a modern server key

1. Open **Project Settings → API Keys**.
2. In **Secret keys**, click **Create new secret key**.
3. Name it `vidya-edge` and copy the `sb_secret_...` value.
4. Never put this value in the website. It bypasses row-level security and is
   used only inside the Edge Function.

Supabase explains the difference between safe publishable and private secret
keys in [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## 3. Make the two Vidya secrets

Open PowerShell and run the following line twice. Save the first result as the
**owner token** and the second, different result as the **Cron secret**.

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Each result is 64 random characters. Do not reuse the Gemini key, database
password or owner token as the Cron secret.

Your allowed GitHub origin is only the scheme and host. For a page such as
`https://arun.github.io/vidya/`, enter `https://arun.github.io`—do not include
`/vidya/`.

## 4. Deploy the migrations and Edge Function

Open PowerShell in the root of the deployed Vidya repository—the directory that
contains both `index.html` and the new `supabase` folder—then run:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REFERENCE
npx supabase db push --dry-run
npx supabase db push
npx supabase functions deploy vidya-ai --no-verify-jwt
```

`npx` may ask to download the Supabase CLI; approve it. `db push --dry-run` is the
safe preview. Do not use `db reset --linked`; that command deletes remote data.
The official workflow is documented in
[Deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy) and
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

## 5. Add server secrets in Supabase

1. In Supabase open **Edge Functions → Secrets**.
2. Click **Add secret** for each row below; paste the exact name and its value.
3. Click **Save**. Secrets become available without redeploying the function.

| Secret name | Value |
|---|---|
| `GEMINI_API_KEY` | Key copied from Google AI Studio |
| `VIDYA_OWNER_TOKEN` | First random 64-character value |
| `VIDYA_OWNER_USER_ID` | User UID copied from Authentication |
| `VIDYA_CRON_SECRET` | Second random 64-character value |
| `VIDYA_ALLOWED_ORIGINS` | Exact GitHub origin, for example `https://arun.github.io` |
| `VIDYA_SUPABASE_SECRET_KEY` | The `sb_secret_...` server key |
| `VIDYA_GEMINI_FAST_MODEL` | `gemini-3.5-flash-lite` |
| `VIDYA_GEMINI_REASONING_MODEL` | `gemini-3.7-flash` |
| `VIDYA_FAST_INPUT_USD_PER_MILLION` | `0.30`—confirm against the live pricing page |
| `VIDYA_FAST_OUTPUT_USD_PER_MILLION` | `2.50`—confirm against the live pricing page |
| `VIDYA_REASONING_INPUT_USD_PER_MILLION` | `0.75`—confirm against the live pricing page |
| `VIDYA_REASONING_OUTPUT_USD_PER_MILLION` | `3.75`—confirm against the live pricing page |
| `VIDYA_GROUNDING_USD_PER_REQUEST` | `0` while within the included grounding quota; update when billed |
| `VIDYA_REQUESTS_PER_HOUR` | `60` for the personal beta |

If local browser testing is needed, temporarily use a comma-separated value such
as `https://arun.github.io,http://localhost:4173`. Never use `*`.

See [Supabase Function secrets](https://supabase.com/docs/guides/functions/secrets)
for the dashboard and CLI alternatives.

## 6. Give Cron its encrypted call details

The two Cron jobs already exist after `db push`, but safely do nothing until the
Vault entries exist.

1. Open **SQL Editor** in Supabase.
2. Click **New query**.
3. Replace the two placeholders below. The URL must use your project reference;
   the secret must be the same `VIDYA_CRON_SECRET` saved in Edge Functions.
4. Click **Run** once.

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REFERENCE.supabase.co/functions/v1/vidya-ai',
  'vidya_function_url',
  'Vidya scheduled Edge Function URL'
);

select vault.create_secret(
  'PASTE_THE_CRON_SECRET',
  'vidya_cron_secret',
  'Vidya Cron authentication secret'
);
```

Vault encrypts the values on disk. The setup follows
[Supabase Vault](https://supabase.com/docs/guides/database/vault) and
[Supabase Cron](https://supabase.com/docs/guides/cron).

Verify the jobs:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in ('vidya-daily-brief-check', 'vidya-research-refresh');
```

- `vidya-daily-brief-check` checks every 15 minutes and generates at most one
  brief per user's local calendar day at or after the chosen time.
- `vidya-research-refresh` runs at minute 17 every fifth UTC hour and generates
  only when at least 4.5 hours have elapsed.
- Brief rows are retained as unread/read/archived. Refresh does not delete them.

## 7. Connect the GitHub app

The browser needs only two private settings:

- **Function URL:** `https://YOUR_PROJECT_REFERENCE.supabase.co/functions/v1/vidya-ai`
- **Owner token:** the first random token from step 3.

The owner token must be entered through Vidya Settings and saved inside its
encrypted local vault. Do not place it in `config.js` or commit it to GitHub. The
app sends it as `x-vidya-owner-token`. The Gemini and Supabase secret keys remain
server-only.

The exact request/response shapes are in `VIDYA-AI-API-CONTRACT.md`.

## 8. Test the live API before testing the screen

In PowerShell, set temporary variables for this window only:

```powershell
$vidyaUrl = 'https://YOUR_PROJECT_REFERENCE.supabase.co/functions/v1/vidya-ai'
$vidyaToken = Read-Host 'Paste the Vidya owner token'
$headers = @{ 'x-vidya-owner-token' = $vidyaToken; 'Content-Type' = 'application/json' }
```

Health check:

```powershell
Invoke-RestMethod -Method Post -Uri $vidyaUrl -Headers $headers -Body '{"operation":"health"}'
```

First Coach call:

```powershell
$body = @{ operation='coach'; prompt='Give me a three-step plan for today.' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $vidyaUrl -Headers $headers -Body $body
```

Enable the daily brief at 7:00 AM Toronto time:

```powershell
$body = @{ operation='schedule.update'; enabled=$true; time='07:00'; timezone='America/Toronto' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $vidyaUrl -Headers $headers -Body $body
```

Generate one brief from a small snapshot. This also gives the scheduler its
first context:

```powershell
$body = @{
  operation='brief.generate'
  kind='daily'
  snapshot=@{
    openTasks=@(@{ title='Prepare release review'; dueAt='2026-08-27T15:00:00-04:00' })
    unreadFeed=@()
    libraryItems=@(@{ title='Release notes'; excerpt='Pilot launch requires a QA sign-off.' })
    interests=@('AI','Leadership')
    activity=@()
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri $vidyaUrl -Headers $headers -Body $body
```

## 9. How the cost monitor works

Every Gemini attempt writes only operational metadata to `ai_usage`: operation,
model, input/output token counts, estimated USD, grounding count, success and
duration. Prompts, file excerpts and answers are not written to this log.

The Settings Cost Monitor combines `usage.summary` from the secure backend with
any experimental direct-browser calls made after the last sync. It shows this
month's estimated spend, requests, tokens, grounded searches, a user-set budget
bar and month-end projection without double-counting server-logged calls. Google
taxes, cached tokens, preview-price changes and usage beyond a grounding
allowance can differ. Treat Google Cloud Billing as the invoice source of truth.

Indicative personal-beta scenarios using prices verified August 26, 2026 are:

| Pattern | Approximate monthly USD before tax |
|---|---:|
| Light beta, Supabase Free, local device speech | $1–$3 |
| Active personal use, Supabase Pro and moderate AI/voice | about $37 |
| Heavy optimized use, local device speech and under 5,000 grounded searches | about $51–$64 |

Grounded search is the main variable-cost risk. Gemini 3 currently includes
5,000 grounding searches per month and then lists $14 per 1,000; one prompt can
produce more than one billable search. Re-check the live pricing page before
buying because model pricing changes.

For real spending protection:

1. In Google Cloud Console open **Billing → Budgets & alerts → Create budget**.
2. Start with a small monthly budget and alerts at 50%, 80% and 100%.
3. Open **APIs & Services → Enabled APIs & services → Generative Language API → Quotas**
   and set conservative request limits where available.
4. In Supabase check **Project Settings → Usage** weekly during the beta.

## 10. Security and privacy boundaries

- GitHub Pages is public source code. It must contain no Gemini, Supabase secret,
  owner or Cron token.
- The owner token is equivalent to a password for this private API. Rotate it in
  both Supabase Secrets and the app if a device or backup is exposed.
- Exact-origin CORS reduces accidental browser access but does not replace the
  owner token.
- Row-level security prevents future signed-in users from reading one another's
  rows. The server secret bypasses RLS and therefore stays only in the function.
- Full Library files stay in the local encrypted vault. Only the metadata and
  excerpts included in a brief/Coach snapshot are stored in `assistant_snapshots`
  and sent to Gemini. Do not include confidential employer material unless your
  employer permits that cloud processing.
- A scheduled brief can run while the app is closed only from the most recently
  synchronized snapshot. Open or use Vidya after changing tasks/files so the
  next snapshot is fresh.
- If you want strictly local-only data, leave scheduled briefs off and do not
  connect the cloud endpoint. Genuine AI will then remain unavailable.

## Quality ladder without API sprawl

Keep only these two paid-capable providers during the personal beta: Supabase and
Gemini. Routine summaries, task refinement and normal Library Q&A use
`gemini-3.5-flash-lite`. Briefs, visual work and current/deep questions use
`gemini-3.7-flash`. Use this routing for at least one week while the Cost Monitor
records your real usage.

If quality or pricing changes, update the matching model and price secrets
together. Do not change only a model—the Cost Monitor would become inaccurate.
Model routing is usually a better personal-assistant upgrade than adding several
separate paid APIs.

OpenAlex, Crossref and Wikimedia remain the recommended no-cost discovery layer.
They supply scholarly metadata, DOI validation, general context and licensed
editorial images; Gemini performs the synthesis only when needed. OpenAlex offers
a free API key at [OpenAlex settings](https://openalex.org/settings/api). Crossref
and Wikimedia can be called without a paid key, subject to their published rate
and attribution rules.

The five-hour research refresh is a concise, source-grounded brief, not Google's
long-running Deep Research agent. That is deliberate: it is faster, easier to
audit and much cheaper. Add a managed Deep Research operation only after the
normal brief proves insufficient and a monthly budget has been measured.

## Troubleshooting

- `origin_not_allowed`: enter only the deployed scheme/host in
  `VIDYA_ALLOWED_ORIGINS`, then reload the app.
- `unauthorized`: the app's owner token does not match the Edge Function secret.
- `ai_not_configured`: add `GEMINI_API_KEY` in Edge Functions Secrets.
- `server_not_configured`: check the owner UUID, allowed origin and server key.
- `ai_provider_error`: inspect **Edge Functions → vidya-ai → Logs**, then check
  Gemini quota/billing. Logs intentionally do not contain prompts or keys.
- No scheduled brief: confirm `schedule.update` is enabled, a snapshot has been
  generated at least once, both Vault secrets exist, and inspect
  `cron.job_run_details`.
