# Vidya — functional personal beta

Release date: August 27, 2026

This is the current release folder. Vidya is a mobile-first Progressive Web App:
it opens from an HTTPS website in Safari, Chrome or Edge and can be installed on
an iPhone or iPad Home Screen. On first use, create your own local vault password
and save the recovery key. There is no built-in or hard-coded password.

## What is useful before cloud AI is connected

No API is required for encrypted tasks, reminders while the app is open,
`@Subjects`, `#tags`, the planner/calendar export, local Library extraction and
search, source-cited local answers, Scribe note/sketch storage, backups, themes,
interests, the finite knowledge edition or the local command brief. OpenAlex and
Wikimedia provide keyless research metadata and editorial images when online.

The secure AI engine adds stronger Coach synthesis, selected-file reasoning,
visual interpretation, current web research, stored/scheduled command briefs and
server-side cost records. It uses only one Supabase project and one Gemini key.

## Test on this computer

From PowerShell:

```powershell
cd "C:\Users\arunk\Documents\Codex\2026-08-06\as\outputs\Vidya-OS-FUNCTIONAL-BETA-2026-08-26"
py -m http.server 4192 --bind 127.0.0.1
```

Open `http://127.0.0.1:4192/index.html`. Use your permanent HTTPS website for
iPhone/iPad installation and device unlock.

## Replace the GitHub Pages deployment

1. Upload every file and folder from this release into the root of the GitHub
   repository you already deployed. Keep `.github/workflows/deploy-pages.yml`.
2. Never upload a Gemini key, Supabase server key, owner token, Cron secret,
   private document or unencrypted backup.
3. Open **GitHub → your repository → Actions** and wait for **Deploy Vidya to
   GitHub Pages** to finish with a green check.
4. Open **Settings → Pages**, use the shown HTTPS address, and hard refresh.
5. On iPhone/iPad open that address in Safari, then **Share → Add to Home Screen**.

## Connect the secure engine

Follow `Documentation/CLOUD-AI-SETUP.md` from top to bottom. After deploying the
included Supabase migrations and `vidya-ai` Edge Function, open Vidya:

1. **Settings → Intelligence engine**.
2. Paste the Edge Function URL and personal owner token.
3. Tap **Test secure engine**.
4. Set the monthly budget warning and daily brief time.
5. Tap **Save settings**, then **Build fresh brief** on Brief.

The Gemini and Supabase secret keys remain on the server. Only the function URL
and personal token are stored inside the encrypted local vault.

## Ask an uploaded file

Open **Library**. Every upload appears under **Subjects & sources**. `@Subject`
is its broad shelf; generated `#keywords` and file type help narrow/search it.
Tap **Ask** beside one file, then type your own question in Coach. Use the source
button beside Coach Send to select up to five files for comparison. The selected
file chips above the conversation show exactly what Coach is using.

The complete option-by-option guide is in the `Documentation` folder.
