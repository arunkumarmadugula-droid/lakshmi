# Vidya AI integration contract

## Endpoint and authentication

Use one HTTPS endpoint:

```text
POST https://PROJECT_REF.supabase.co/functions/v1/vidya-ai
```

Browser requests send:

```http
Content-Type: application/json
x-vidya-owner-token: <token read from the encrypted Vidya vault>
```

Do not put the owner token in HTML, JavaScript defaults, `config.js`, a URL or a
GitHub secret intended for Pages. The endpoint also accepts
`Authorization: Bearer <Supabase user JWT>` after the app gains Supabase login.
Only Supabase Cron sends `x-vidya-cron-secret`.

All failures use:

```json
{
  "ok": false,
  "error": { "code": "machine_readable_code", "message": "Safe explanation" }
}
```

## Minimal browser helper

```js
async function callVidya(operation, payload, functionUrl, ownerToken) {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vidya-owner-token": ownerToken
    },
    body: JSON.stringify({ operation, ...payload })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Vidya request failed");
  return result;
}
```

## `health`

Checks endpoint configuration without spending Gemini tokens. It still requires
authentication.

```json
{ "operation": "health" }
```

## `coach`

Answers from the user question plus a deliberately small app snapshot. Set
`deepResearch` only when current web evidence is necessary; it enables Google
Search grounding and may add tool cost.

```json
{
  "operation": "coach",
  "prompt": "What changed in the release notes and what should I do?",
  "deepResearch": false,
  "snapshot": {
    "openTasks": [{ "id": "t1", "title": "Review launch", "dueAt": "2026-08-27T15:00:00-04:00" }],
    "unreadFeed": [],
    "libraryItems": [
      {
        "id": "lib-42",
        "title": "August release notes",
        "type": "pdf",
        "excerpt": "The pilot requires QA sign-off before customer release."
      }
    ],
    "interests": ["AI", "Leadership"],
    "activity": []
  }
}
```

This is how file questions work: the Library UI identifies the selected item,
extracts or retrieves relevant text locally, and places only those excerpts in
`libraryItems`. The encrypted IndexedDB file is not magically visible to the
server. Always include Library IDs and titles so the answer can display a clear
source reference. Full semantic retrieval across very large libraries is a later
RAG/indexing feature, not part of this personal-beta endpoint.

AI responses use:

```json
{
  "ok": true,
  "text": "Direct answer",
  "data": {
    "text": "Direct answer",
    "keyPoints": [],
    "actions": [],
    "sourceReferences": ["August release notes"],
    "limitations": [],
    "followUp": "Optional next question"
  },
  "sources": [],
  "usage": {
    "inputTokens": 420,
    "outputTokens": 180,
    "totalTokens": 600,
    "estimatedUsd": 0.000114,
    "model": "gemini-3.5-flash-lite",
    "operation": "coach",
    "groundedRequests": 0,
    "logged": true
  }
}
```

`sources` contains web titles/URLs only when grounding was used. Library source
names are in the structured `sourceReferences` array.

## `visual`

Send a compressed image as base64 without a data-URL prefix. Supported types are
JPEG, PNG, WebP, HEIC and HEIF; keep the original binary near or below 7 MB.

```json
{
  "operation": "visual",
  "prompt": "Read this handwritten planning page and suggest three tasks.",
  "image": { "mimeType": "image/jpeg", "data": "BASE64_BYTES" }
}
```

The response has `text`, `data.observations`, `data.actions`,
`data.uncertainty` and `usage`. The app should let the user review proposed tasks
before creating them.

## `brief.generate`

Generates, stores and returns a structured brief. Accepted kinds are `daily`,
`tomorrow`, `research_refresh` and `manual`.

```json
{
  "operation": "brief.generate",
  "kind": "daily",
  "snapshot": {
    "openTasks": [],
    "unreadFeed": [],
    "libraryItems": [],
    "interests": [],
    "activity": []
  }
}
```

The response includes:

```json
{
  "ok": true,
  "text": "Short overview",
  "brief": {
    "title": "Morning brief",
    "greeting": "...",
    "overview": "...",
    "priorities": [],
    "schedule": [],
    "researchHighlights": [],
    "libraryConnections": [],
    "actions": [],
    "reflection": "..."
  },
  "sources": [],
  "usage": {}
}
```

Submitting this operation also replaces the stored scheduler snapshot. Keep the
snapshot small: at most 100 tasks, 50 unread items, 30 selected Library items,
100 interests and 50 recent activities, with short excerpts rather than files.

## `brief.latest`

Returns the newest stored brief without spending AI tokens. `kind` is optional.

```json
{ "operation": "brief.latest", "kind": "daily" }
```

```json
{ "ok": true, "brief": { "id": "...", "kind": "daily", "content": {}, "sources": [], "status": "unread", "created_at": "..." } }
```

## `schedule.update`

Creates or updates the personal daily schedule. The timezone must be an IANA
name. `researchEnabled` is optional and defaults to the value of `enabled`, so
turning the schedule off also prevents background research charges.

```json
{
  "operation": "schedule.update",
  "enabled": true,
  "time": "07:00",
  "timezone": "America/Toronto",
  "researchEnabled": true
}
```

Daily Cron checks every 15 minutes and produces at most one brief per local day.
Research Cron checks every five hours. It keeps every stored brief; nothing is
deleted on refresh.

## `usage.summary`

Returns the Cost Monitor aggregate and up to 50 recent rows. `from` is optional;
the default is the start of the current UTC month.

```json
{ "operation": "usage.summary", "from": "2026-08-01T00:00:00Z" }
```

```json
{
  "ok": true,
  "from": "2026-08-01T00:00:00.000Z",
  "summary": {
    "requests": 42,
    "failedRequests": 1,
    "inputTokens": 20000,
    "outputTokens": 5000,
    "totalTokens": 25000,
    "groundedRequests": 4,
    "estimatedUsd": 0.004
  },
  "recent": []
}
```

The estimate uses the price secrets configured for the selected model. Google
Cloud Billing remains the source of truth.

## Scheduler-only call

Cron calls the same endpoint with `x-vidya-cron-secret` and this body:

```json
{ "operation": "brief.generate", "kind": "research_refresh", "scheduled": true }
```

The browser must never possess or send the Cron secret.

## Stored data

- `assistant_snapshots`: the most recent small task/feed/Library/activity context
  needed when the browser is closed.
- `ai_briefs`: structured briefs with unread/read/archived state.
- `ai_usage`: tokens, estimated cost, model, operation and success; no prompts or
  answers.
- `brief_schedules`: time, timezone and last-run timestamps.

All tables have row-level security. The personal owner-token path is mapped to a
single real Supabase Auth user ID and accesses the tables only through the Edge
Function's server key.
