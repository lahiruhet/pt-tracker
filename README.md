# PT Tracker

A mobile app for a personal trainer's client tracker. The Google Sheet stays the place you can always edit; the app keeps its own fast copy in Cloudflare D1 (SQLite) and the two stay in sync both ways.

- **Website:** https://pt-tracker.stackmoth.com (behind Cloudflare Access sign-in)
- **Android app:** an APK built by GitHub Actions (see [Android app](#android-app))

```
 Google Sheet ──(edit)──► Apps Script trigger ──► Worker /api/hook/sheet ──► D1 (SQLite)
      ▲                                                                     │
      └───────────── app changes written straight to the sheet ◄────────────┘
                     + full re-check every 5 minutes (cron)
                                        │
                         React app (website + Android shell)
```

## What's where

| Path | What |
|---|---|
| `worker/` | Cloudflare Worker (Hono): API, sync engine, cron, Access check |
| `shared/schema.ts` | Which sheet columns map to which fields; used by Worker and app |
| `migrations/` | D1 schema |
| `apps-script/Code.gs` | Script that lives inside the Google Sheet |
| `web/` | The app (React, Tailwind, TanStack Query) |
| `android/`, `capacitor.config.ts` | Android shell (Capacitor) |
| `mock/` | Fake sheet + end-to-end sync tests |
| `scripts/` | Dev stack, screenshots, UI smoke test, Cloudflare setup, signing key |

## How sync works

- Each synced tab (**Clients**, **Session Log**, **Strength Log**) gets two hidden columns: `_id` (permanent row id) and `_updated` (last change time). Columns are matched by header text, so you can reorder them.
- **Sheet → app:** an installable edit/change trigger sends the edited tab to the Worker, which applies only what changed. Open apps check a tiny revision counter every 8 s and refetch when it moves.
- **App → sheet:** every add/edit/delete is saved in D1 and written to the sheet straight away. If the sheet can't be reached, the change stays queued and is retried by the 5-minute cron.
- **Conflicts:** if the same row changed in both places, the newer change wins.
- **Safety:** if more than half of a tab suddenly disappears from the sheet, the Worker refuses to delete those rows in the app and shows a warning in Settings.
- **Formulas:** formula columns (Sessions in chat, Last session, the Progress tab) are never written by the app; new rows added from the app copy the formulas down from the row above.
- **Renames:** renaming a client in the app renames them on every log row too.
- **Offline:** the app keeps the last data on the phone and queues edits made without signal.

## Connect the sheet

1. In the sheet: **Extensions → Apps Script**. Replace the code with `apps-script/Code.gs`. In **Project Settings**, tick *Show "appsscript.json"* and replace it with `apps-script/appsscript.json`.
2. **Project Settings → Script properties**, add:
   - `SHARED_SECRET`: the value in `.sheet-secret` (created by `scripts/setup-cloudflare.sh`)
   - `WORKER_URL`: `https://pt-tracker.stackmoth.com`
3. Select `setup` in the toolbar and **Run** (approve the permissions). This adds the hidden `_id`/`_updated` columns and installs the triggers.
4. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Copy the `/exec` URL.
5. `npx wrangler secret put SHEET_SCRIPT_URL` and paste the URL. Then press **Sync now** in the app's Settings.

The web app URL only accepts requests carrying the shared secret.

## Deploy (Cloudflare)

Needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and network access to `api.cloudflare.com`.

```sh
ALLOWED_EMAILS="first@example.com,second@example.com" \
SHEET_URL="https://docs.google.com/spreadsheets/d/…/edit" \
DISPLAY_NAMES="first@example.com=Name,second@example.com=Name" \
scripts/setup-cloudflare.sh
```

It creates the D1 database, runs migrations, sets up Cloudflare Access (email one-time code sign-in, 30-day sessions, only the listed emails, plus a bypass for the sheet hook path), deploys to `pt-tracker.stackmoth.com` and sets the secrets. Later deploys: `npm run deploy`.

## Android app

The APK is a native shell (Capacitor) around the live site, so **UI updates ship by deploying the Worker; the APK rarely needs rebuilding**. Native bits: app icon and splash, Android back button, haptics, the system share sheet (to send weights on WhatsApp), status bar colours, and an offline screen.

**Getting it on the phone**

1. GitHub → **Actions → Android APK → Run workflow** (it also runs when `android/` changes).
2. When it finishes, open the repo's **Releases** page on the phone and tap the `.apk`.
3. Android asks to allow installs from the browser once; allow it, then **Install**. If Play Protect warns about an unknown app, choose **Install anyway** (it's your own build).
4. Open **PT Tracker**, enter your email, and type the code Cloudflare emails you. You stay signed in for 30 days.

**Signing:** without secrets, CI builds a debug APK. For a stable signed release (so each new APK installs over the old one), run once on a machine with Java and the GitHub CLI: `scripts/make-keystore.sh lahiruhet/pt-tracker`.

## Local development

```sh
npm install
scripts/dev-stack.sh fresh   # mock sheet on :8788 + Worker on :8787 (local D1)
npx vite                     # app on http://127.0.0.1:5173
node mock/e2e.mjs            # 15 two-way sync tests against the mock sheet
node scripts/ui-smoke.mjs    # click-through test in a phone-sized browser
node scripts/screenshots.mjs /tmp/shots
```

`.dev.vars` for local runs:

```
SHEET_SCRIPT_URL=http://127.0.0.1:8788/
SHEET_SECRET=dev-secret
ALLOW_NO_AUTH=1
```

The mock sheet uses made-up people. This repo is public: keep real client data, emails and secrets out of it (they live in Cloudflare secrets and the sheet).
