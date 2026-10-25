// One-time Cloudflare setup + deploy for pt-tracker.stackmoth.com. Works on Windows, macOS and Linux.
// Safe to re-run: it skips what already exists and only asks for settings you want to set or change.
//
//   npx wrangler login          (once, if `npx wrangler whoami` doesn't show your account)
//   node scripts/setup.mjs
//
// Optional: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID with "Access: Apps and Policies Edit" and
// "Access: Organizations, Identity Providers, and Groups Edit" sets up Cloudflare Access automatically.
// Without them the script tells you the few clicks to do in the dashboard.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DOMAIN = "pt-tracker.stackmoth.com";
const root = fileURLToPath(new URL("..", import.meta.url));
// A fresh prompt per question, so wrangler's own prompts in between get the terminal to themselves.
async function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${q}: `)).trim();
  } finally {
    rl.close();
  }
}
const step = (s) => console.log(`\n\x1b[1m→ ${s}\x1b[0m`);

function run(cmd, args, { capture = false, input } = {}) {
  // One command string (all arguments here are fixed or quoted by us), so Windows' npx.cmd works.
  const res = spawnSync([cmd, ...args].join(" "), {
    cwd: root,
    shell: true,
    encoding: "utf8",
    input,
    stdio: capture || input !== undefined ? ["pipe", "pipe", "inherit"] : "inherit",
  });
  if (res.status !== 0) {
    if (capture && res.stdout) console.error(res.stdout);
    throw new Error(`${cmd} ${args.join(" ")} failed`);
  }
  return res.stdout ?? "";
}
const wrangler = (args, opts) => run("npx", ["wrangler", ...args], opts);
const json = (s) => JSON.parse(s.slice(s.search(/[[{]/)));

try {
  step("Checking your Cloudflare login");
  wrangler(["whoami"]);

  step("D1 database");
  const find = () => json(wrangler(["d1", "list", "--json"], { capture: true })).find((d) => d.name === "pt-tracker");
  let db = find();
  if (!db) {
    // Point the existing DB binding at the new database, without wrangler's interactive questions.
    wrangler(["d1", "create", "pt-tracker", "--binding", "DB", "--update-config"]);
    db = find();
  }
  const cfgPath = join(root, "wrangler.jsonc");
  const cfg = readFileSync(cfgPath, "utf8").replace(/"database_id": "[^"]*"/, `"database_id": "${db.uuid}"`);
  writeFileSync(cfgPath, cfg);
  console.log(`pt-tracker database: ${db.uuid}`);
  wrangler(["d1", "migrations", "apply", "pt-tracker", "--remote"]);

  step(`Build and deploy to https://${DOMAIN}`);
  run("npm", ["run", "build"]);
  try {
    wrangler(["deploy"]);
  } catch (err) {
    console.log(`
Deploy failed. If the error says [code: 10013] (Cloudflare's generic server error):
  - open dash.cloudflare.com → Workers & Pages once; a new account asks you to pick a
    workers.dev subdomain (and to verify your email). Do that, then run this script again.
  - otherwise check https://www.cloudflarestatus.com, wait a few minutes and run it again.
If it says the zone or route isn't found: stackmoth.com must be a zone in this same account.`);
    throw err;
  }

  step("Cloudflare Access (sign-in in front of the site)");
  const secrets = {};
  const emails = await ask("Emails allowed to sign in (comma-separated)");
  if (emails) secrets.ALLOWED_EMAILS = emails;
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID && emails) {
    Object.assign(secrets, await setupAccess(emails));
  } else {
    console.log(`
In the Cloudflare dashboard → Zero Trust (pick the Free plan if asked):
  1. Settings → Authentication → Login methods → Add new → One-time PIN.
  2. Access → Applications → Add an application → Self-hosted:
       name "PT Tracker", domain ${DOMAIN}, session duration 1 month,
       policy: Allow, Include → Emails → ${emails || "your emails"}. Save.
     Open the app again and copy its "Application Audience (AUD) Tag".
  3. Add another Self-hosted application: domain ${DOMAIN}, path api/hook,
       policy: Bypass, Include → Everyone. (The sheet uses this; the Worker checks its secret.)
  4. Your team domain is under Settings → Custom pages (like yourteam.cloudflareaccess.com).
Press Enter to skip any question and set it later by re-running this script.`);
    const team = await ask("Team domain (xxx.cloudflareaccess.com)");
    const aud = await ask("AUD tag");
    if (team) secrets.ACCESS_TEAM_DOMAIN = team.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (aud) secrets.ACCESS_AUD = aud;
  }

  step("Google Sheet connection");
  console.log("From the sheet's Apps Script: run setup(), then Deploy → New deployment → Web app.");
  const sheetSecret = await ask("SHEET_SECRET (printed in the Apps Script log by setup())");
  const scriptUrl = await ask("Web app URL (ends in /exec)");
  const sheetUrl = await ask("Link to the Google Sheet (for the Open sheet button)");
  const names = await ask('Greeting names, e.g. "a@x.com=Sadew,b@y.com=Lahiru" (optional)');
  if (sheetSecret) secrets.SHEET_SECRET = sheetSecret;
  if (scriptUrl) secrets.SHEET_SCRIPT_URL = scriptUrl;
  if (sheetUrl) secrets.SHEET_URL = sheetUrl;
  if (names) secrets.DISPLAY_NAMES = names;

  if (Object.keys(secrets).length) {
    step(`Saving ${Object.keys(secrets).join(", ")}`);
    const file = join(tmpdir(), `pt-secrets-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    try {
      wrangler(["secret", "bulk", `"${file}"`]);
    } finally {
      unlinkSync(file);
    }
  }

  console.log(`\nDone. Open https://${DOMAIN} and press "Sync now" in Settings once the sheet is connected.`);
} catch (err) {
  console.error(`\n✘ ${err.message}`);
  process.exitCode = 1;
}

async function setupAccess(emails) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}`;
  const cf = async (path, init = {}) => {
    const res = await fetch(api + path, {
      ...init,
      headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    });
    const body = await res.json();
    if (!body.success) throw new Error(`Cloudflare API ${path}: ${JSON.stringify(body.errors)}`);
    return body.result;
  };
  const team = (await cf("/access/organizations")).auth_domain;
  let otp = (await cf("/access/identity_providers")).find((p) => p.type === "onetimepin");
  if (!otp) otp = await cf("/access/identity_providers", { method: "POST", body: JSON.stringify({ name: "Email code", type: "onetimepin", config: {} }) });
  const apps = await cf("/access/apps");
  const upsert = async (domain, body) => {
    const existing = apps.find((a) => a.domain === domain);
    return cf(existing ? `/access/apps/${existing.id}` : "/access/apps", {
      method: existing ? "PUT" : "POST",
      body: JSON.stringify({ domain, type: "self_hosted", app_launcher_visible: false, ...body }),
    });
  };
  const main = await upsert(DOMAIN, {
    name: "PT Tracker",
    session_duration: "720h",
    allowed_idps: [otp.id],
    auto_redirect_to_identity: true,
    policies: [{ name: "Trainer", decision: "allow", include: emails.split(",").map((e) => ({ email: { email: e.trim() } })) }],
  });
  await upsert(`${DOMAIN}/api/hook`, {
    name: "PT Tracker sheet hook",
    policies: [{ name: "Sheet hook", decision: "bypass", include: [{ everyone: {} }] }],
  });
  console.log(`Access ready: ${team}`);
  return { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: main.aud };
}
