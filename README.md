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
| `scripts/` | Cloudflare setup, dev stack, screenshots, UI smoke test, signing key |

## How sync works

- Each synced tab (**Clients**, **Session Log**, **Strength Log**) gets two hidden columns: `_id` (permanent row id) and `_updated` (last change time). Columns are matched by header text, so you can reorder them.
- **Sheet → app:** an installable edit/change trigger sends the edited tab to the Worker, which applies only what changed. Open apps check a tiny revision counter every 8 s and refetch when it moves.
- **App → sheet:** every add/edit/delete is saved in D1 and written to the sheet straight away. If the sheet can't be reached, the change stays queued and is retried by the 5-minute cron.
- **Conflicts:** if the same row changed in both places, the newer change wins.
- **Safety:** if more than half of a tab suddenly disappears from the sheet, the Worker refuses to delete those rows in the app and shows a warning in Settings.
- **Formulas:** formula columns (Sessions in chat, Last session, the Progress tab) are never written by the app; new rows added from the app copy the formulas down from the row above.
- **Renames:** renaming a client in the app renames them on every log row too.
- **Offline:** the app keeps the last data on the phone and queues edits made without signal.

## Set up (once)

**1. The sheet.** In the Google Sheet: **Extensions → Apps Script**.

- Replace the code with `apps-script/Code.gs`.
- In **Project Settings**, tick *Show "appsscript.json" manifest file in editor*, then replace that file with `apps-script/appsscript.json`.
- Select `setup` in the toolbar and **Run** (approve the permissions). It adds the hidden `_id`/`_updated` columns, installs the triggers, creates the shared secret and prints it in the log as `SHEET_SECRET for the Worker: …`. Run `showSecret` any time to see it again.
- **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Copy the URL ending in `/exec`. It only answers requests that carry the shared secret.

**2. Cloudflare**, on a computer with Node 20+ and wrangler logged in (`npx wrangler whoami`):

```sh
git clone https://github.com/lahiruhet/pt-tracker && cd pt-tracker
npm install
node scripts/setup.mjs
```

It creates the D1 database, runs the migrations, deploys to `pt-tracker.stackmoth.com`, then asks for the allowed emails, the Cloudflare Access details, the `SHEET_SECRET` and `/exec` URL from step 1, and the sheet link, and saves them as Worker secrets. Leave an answer blank to skip it; re-run the script any time to change settings.

Cloudflare Access: with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set (Access edit permissions), the script sets it up itself. Otherwise it lists the dashboard clicks: one-time email code login, an app for the site allowing only your emails with 30-day sessions, and a bypass for `/api/hook` (the sheet's change hook, which the Worker checks with the shared secret).

**3.** Open https://pt-tracker.stackmoth.com, sign in with the emailed code, and press **Sync now** in Settings.

Later deploys: `npm run deploy`.

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
