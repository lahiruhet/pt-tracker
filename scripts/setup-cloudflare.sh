#!/usr/bin/env bash
# One-time Cloudflare setup + deploy for pt-tracker.stackmoth.com. Safe to re-run.
#
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment. Token permissions:
#   Account: Workers Scripts Edit, D1 Edit, Access: Apps and Policies Edit,
#            Access: Organizations, Identity Providers, and Groups Edit
#   Zone (stackmoth.com): Workers Routes Edit, DNS Edit
#
#   scripts/setup-cloudflare.sh
# Prints the shared secret to paste into the Apps Script once (written to .sheet-secret, git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
DOMAIN="pt-tracker.stackmoth.com"
EMAILS="${ALLOWED_EMAILS:?set ALLOWED_EMAILS=a@x.com,b@y.com}"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
cf() { curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "content-type: application/json" "$@"; }

echo "→ D1 database"
DB_ID=$(npx wrangler d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0));const d=l.find(x=>x.name==="pt-tracker");process.stdout.write(d?d.uuid:"")')
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create pt-tracker >/dev/null
  DB_ID=$(npx wrangler d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0));process.stdout.write(l.find(x=>x.name==="pt-tracker").uuid)')
fi
sed -i "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB_ID\"/" wrangler.jsonc
npx wrangler d1 migrations apply pt-tracker --remote

echo "→ Cloudflare Access (sign-in in front of the whole site)"
TEAM=$(cf "$API/access/organizations" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).result.auth_domain)')
OTP=$(cf "$API/access/identity_providers" | node -e 'const r=JSON.parse(require("fs").readFileSync(0)).result;const p=r.find(x=>x.type==="onetimepin");process.stdout.write(p?p.id:"")')
if [ -z "$OTP" ]; then
  OTP=$(cf -X POST "$API/access/identity_providers" -d '{"name":"Email code","type":"onetimepin","config":{}}' | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).result.id)')
fi
INCLUDE=$(node -e 'console.log(JSON.stringify(process.argv[1].split(",").map(e=>({email:{email:e.trim()}}))))' "$EMAILS")
APPS=$(cf "$API/access/apps")
app_id() { echo "$APPS" | node -e 'const r=JSON.parse(require("fs").readFileSync(0)).result;const a=r.find(x=>x.domain===process.argv[1]);process.stdout.write(a?a.id:"")' "$1"; }

MAIN_ID=$(app_id "$DOMAIN")
MAIN_BODY=$(cat <<JSON
{"name":"PT Tracker","domain":"$DOMAIN","type":"self_hosted","session_duration":"720h",
 "allowed_idps":["$OTP"],"auto_redirect_to_identity":true,"app_launcher_visible":false,
 "policies":[{"name":"Trainer","decision":"allow","include":$INCLUDE}]}
JSON
)
if [ -z "$MAIN_ID" ]; then
  AUD=$(cf -X POST "$API/access/apps" -d "$MAIN_BODY" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).result.aud)')
else
  AUD=$(cf -X PUT "$API/access/apps/$MAIN_ID" -d "$MAIN_BODY" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).result.aud)')
fi

# The sheet's change hook must reach the Worker without signing in; the Worker checks its secret.
HOOK_ID=$(app_id "$DOMAIN/api/hook")
HOOK_BODY="{\"name\":\"PT Tracker sheet hook\",\"domain\":\"$DOMAIN/api/hook\",\"type\":\"self_hosted\",\"app_launcher_visible\":false,\"policies\":[{\"name\":\"Sheet hook\",\"decision\":\"bypass\",\"include\":[{\"everyone\":{}}]}]}"
if [ -z "$HOOK_ID" ]; then cf -X POST "$API/access/apps" -d "$HOOK_BODY" >/dev/null; else cf -X PUT "$API/access/apps/$HOOK_ID" -d "$HOOK_BODY" >/dev/null; fi

sed -i "s/\"ACCESS_TEAM_DOMAIN\": \"[^\"]*\"/\"ACCESS_TEAM_DOMAIN\": \"$TEAM\"/; s/\"ACCESS_AUD\": \"[^\"]*\"/\"ACCESS_AUD\": \"$AUD\"/" wrangler.jsonc

echo "→ Build + deploy"
npm run build
npx wrangler deploy

echo "→ Secrets"
if [ ! -f .sheet-secret ]; then openssl rand -hex 32 > .sheet-secret; fi
npx wrangler secret put SHEET_SECRET < .sheet-secret
printf '%s' "$EMAILS" | npx wrangler secret put ALLOWED_EMAILS
[ -n "${SHEET_URL:-}" ] && printf '%s' "$SHEET_URL" | npx wrangler secret put SHEET_URL
[ -n "${DISPLAY_NAMES:-}" ] && printf '%s' "$DISPLAY_NAMES" | npx wrangler secret put DISPLAY_NAMES
[ -n "${SHEET_SCRIPT_URL:-}" ] && printf '%s' "$SHEET_SCRIPT_URL" | npx wrangler secret put SHEET_SCRIPT_URL

echo
echo "Done: https://$DOMAIN"
echo "Shared secret for the Apps Script (Script property SHARED_SECRET) is in .sheet-secret"
[ -z "${SHEET_SCRIPT_URL:-}" ] && echo "After deploying the Apps Script web app, run: npx wrangler secret put SHEET_SCRIPT_URL"
exit 0
