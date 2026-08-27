# Vidya functional beta test report

Release: `2026-08-27`  
Package: `Vidya-OS-FUNCTIONAL-BETA-2026-08-26`

## Automated checks passed

- JavaScript syntax: `app.js`, `assistant.js` and `auth.js`.
- First-run encrypted vault creation and app initialization.
- 390 × 844 phone: no horizontal page spread.
- 820 × 1180 iPad portrait: Library width equals viewport; touch navigation used.
- 1180 × 820 iPad landscape: no spread; compact side rail used.
- Mobile/iPad Library source list and source dialog remain inside the viewport.
- **Ask** attaches the exact file, leaves Coach input ready for the user's own
  question, and local cited file Q&A works without an AI API.
- Searchable multi-source Coach picker and removable source context chips.
- Floating **Activate Vidya** control is hidden on Coach; Send remains fully
  visible and clickable at phone size.
- Scribe Write/Scan/Sketch modes and Tasks/Summary/Explanation/Plan outcomes.
- Local command brief works without an API.
- Mocked secure-engine health authentication, owner-token header, Coach request,
  selected Library excerpt payload and structured AI command brief.
- Cost Monitor combined server summary and new secure calls without double count;
  test result showed `$0.007` from the mocked usage records.
- No uncaught browser errors during the full responsive/integration run.

## Static/backend checks passed

- Edge Function TypeScript structure and secret scan.
- SQL migrations include private owner data, row-level security, schedules,
  retained briefs, usage logging and five-hour research Cron.
- GitHub Pages CSP allows only the required origins, including Supabase HTTPS.
- No production secret is present in the release defaults.

## Live-device and cloud checks still required

The desktop suite cannot perform a real iPhone Face ID/WebAuthn ceremony or call
your not-yet-supplied Gemini/Supabase account. After deployment, follow
`Documentation/CLOUD-AI-SETUP.md`, then test on iPhone/iPad:

1. device unlock success, cancel and password fallback;
2. secure-engine health and one selected-file Coach question;
3. one visual interpretation and one scheduled brief;
4. actual Google/Supabase usage against Vidya's estimate;
5. a cross-user/RLS denial test before any multi-user expansion.

Closed-app web push delivery is not claimed by this beta. The backend stores and
generates briefs while the website is closed; the latest brief appears when Vidya
next syncs. A native companion or additional Web Push enrollment is a later step.
