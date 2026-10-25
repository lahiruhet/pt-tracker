// End-to-end sync test: Worker (wrangler dev) <-> mock sheet.
//   terminal 1: node mock/sheet-server.mjs
//   terminal 2: npx wrangler dev --port 8787   (with .dev.vars from README)
//   terminal 3: node mock/e2e.mjs
import assert from "node:assert/strict";

const API = process.env.API ?? "http://127.0.0.1:8787";
const SHEET = process.env.SHEET ?? "http://127.0.0.1:8788";

async function j(url, opts = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok && !opts.allowError) throw new Error(`${opts.method ?? "GET"} ${url} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const api = (path, opts) => j(API + path, opts);
const sheet = (path, body) => j(SHEET + path, body ? { method: "POST", body } : {});
const state = () => sheet("/__state");
const boot = () => api("/api/bootstrap");
const row = (snap, id) => {
  const r = snap.rows.find((x) => x.id === id);
  return r ? Object.fromEntries(snap.headers.map((h, i) => [h, r.values[i]])) : undefined;
};

async function until(fn, label, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("timed out: " + label);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("✓", name);
}

await sheet("/__reset", {});
await api("/api/sync", { method: "POST" }); // settle

await test("initial pull mirrors the sheet", async () => {
  const s = await state();
  await api("/api/sync", { method: "POST" });
  const b = await boot();
  assert.equal(b.clients.length, s.Clients.rows.length);
  assert.equal(b.sessions.length, s["Session Log"].rows.length);
  assert.equal(b.strength.length, s["Strength Log"].rows.length);
  const alex = b.clients.find((c) => c.name === "Alex");
  assert.equal(alex.price, "1200");
  assert.equal(alex.start_date, "2026-08-12");
  assert.equal(b.clients.find((c) => c.name === "Priya").price, "100/session");
});

let newClientId;
await test("app → sheet: create client lands as a new sheet row", async () => {
  const c = await api("/api/clients", {
    method: "POST",
    body: { name: "Zoe", start_date: "2026-10-25", package: "Monthly", price: "1100", payment_status: "Not paid", notes: "Sets 10/12" },
  });
  newClientId = c.id;
  assert.equal(c.pending, true);
  const r = await until(async () => row((await state()).Clients, c.id), "client in sheet");
  assert.equal(r.Client, "Zoe");
  assert.equal(r["Price (AED/month)"], 1100, "numeric price written as a number");
  assert.equal(r["Start date"], "2026-10-25");
  assert.equal(r.Notes, "Sets 10/12", "text stays text");
  const b = await until(async () => (await boot()).clients.find((x) => x.id === c.id && !x.pending), "not pending");
  assert.ok(b);
});

await test("duplicate client names are refused", async () => {
  const res = await api("/api/clients", { method: "POST", body: { name: "zoe" }, allowError: true });
  assert.match(res.error, /already exists/);
});

let workoutIds;
await test("app → sheet: log a workout (weights + session)", async () => {
  const res = await api("/api/workouts", {
    method: "POST",
    body: {
      client: "Zoe",
      date: "2026-10-25",
      workout: "Upper 1",
      entries: [
        { exercise: "Lat pulldown", weight_kg: 30, load_text: "30kg", sets_reps: "3 x 10" },
        { exercise: "Lateral raise", weight_kg: null, load_text: "2nd plate", sets_reps: "2 x 10–12" },
      ],
      session: { focus: "Upper 1", notes: "Logged in app" },
    },
  });
  workoutIds = res;
  const s = await until(async () => {
    const st = await state();
    return row(st["Strength Log"], res.strength_ids[1]) && row(st["Session Log"], res.session_id) ? st : null;
  }, "workout in sheet");
  assert.equal(row(s["Strength Log"], res.strength_ids[0])["Weight (kg)"], 30);
  assert.equal(row(s["Strength Log"], res.strength_ids[1])["Weight (kg)"], "");
  assert.equal(row(s["Session Log"], res.session_id)["Evidence in chat"], "Logged in app");
  assert.equal(row(s.Clients, newClientId)["Sessions in chat"], 1, "sheet formula counts the new session");
});

await test("app → sheet: edit a row", async () => {
  await api(`/api/strength/${workoutIds.strength_ids[0]}`, { method: "PATCH", body: { weight_kg: 32.5, load_text: "32.5kg" } });
  await until(async () => row((await state())["Strength Log"], workoutIds.strength_ids[0])?.["Weight (kg)"] === 32.5, "edit in sheet");
});

await test("sheet → app: editing a cell reaches the app via the hook", async () => {
  await sheet("/__edit", { tab: "Clients", id: newClientId, values: { "Payment status": "Paid 1,100", "Last payment": "2026-10-26" } });
  const c = (await boot()).clients.find((x) => x.id === newClientId);
  assert.equal(c.payment_status, "Paid 1,100");
  assert.equal(c.last_payment, "2026-10-26");
});

let sheetRowId;
await test("sheet → app: a row typed into the sheet appears in the app", async () => {
  const res = await sheet("/__edit", {
    tab: "Session Log",
    values: { Date: "2026-10-26", Client: "Zoe", "Session / focus": "Lower", "Evidence in chat": "Typed in sheet" },
  });
  sheetRowId = res.id;
  const s = (await boot()).sessions.find((x) => x.id === res.id);
  assert.equal(s.focus, "Lower");
});

await test("sheet → app: deleting a row in the sheet removes it from the app", async () => {
  await sheet("/__delete", { tab: "Session Log", id: sheetRowId });
  assert.equal((await boot()).sessions.find((x) => x.id === sheetRowId), undefined);
});

await test("app → sheet: deleting in the app deletes the sheet row", async () => {
  await api(`/api/strength/${workoutIds.strength_ids[1]}`, { method: "DELETE" });
  assert.equal((await boot()).strength.find((x) => x.id === workoutIds.strength_ids[1]), undefined);
  await until(async () => !row((await state())["Strength Log"], workoutIds.strength_ids[1]), "row gone from sheet");
});

await test("offline sheet: app edits queue up and go through on the next sync", async () => {
  await sheet("/__offline", { offline: true });
  await api(`/api/clients/${newClientId}`, { method: "PATCH", body: { schedule: "Mon/Wed/Fri 7am" } });
  await new Promise((r) => setTimeout(r, 400));
  let st = await api("/api/sync");
  assert.ok(st.pending >= 1, "edit still pending");
  assert.ok(st.last_error);
  await sheet("/__offline", { offline: false });
  await api("/api/sync", { method: "POST" });
  st = await api("/api/sync");
  assert.equal(st.pending, 0);
  assert.equal(row((await state()).Clients, newClientId)["Schedule / next session"], "Mon/Wed/Fri 7am");
});

await test("conflict: a newer sheet edit beats an older unsent app edit", async () => {
  await sheet("/__offline", { offline: true });
  await api(`/api/clients/${newClientId}`, { method: "PATCH", body: { goal: "From app (older)" } });
  await new Promise((r) => setTimeout(r, 50));
  await sheet("/__offline", { offline: false });
  await sheet("/__hook", { enabled: false });
  await sheet("/__edit", { tab: "Clients", id: newClientId, values: { Goal: "From sheet (newer)" } });
  await sheet("/__hook", { enabled: true });
  await api("/api/sync", { method: "POST" });
  assert.equal((await boot()).clients.find((x) => x.id === newClientId).goal, "From sheet (newer)");
  assert.equal(row((await state()).Clients, newClientId).Goal, "From sheet (newer)");
});

await test("conflict: a newer app edit beats an older sheet edit", async () => {
  await sheet("/__hook", { enabled: false });
  await sheet("/__edit", { tab: "Clients", id: newClientId, values: { Goal: "From sheet (older)" } });
  await sheet("/__hook", { enabled: true });
  await new Promise((r) => setTimeout(r, 50));
  await sheet("/__offline", { offline: true });
  await api(`/api/clients/${newClientId}`, { method: "PATCH", body: { goal: "From app (newer)" } });
  await sheet("/__offline", { offline: false });
  await api("/api/sync", { method: "POST" });
  assert.equal((await boot()).clients.find((x) => x.id === newClientId).goal, "From app (newer)");
  assert.equal(row((await state()).Clients, newClientId).Goal, "From app (newer)");
});

await test("rename a client renames their log rows in the sheet", async () => {
  await api(`/api/clients/${newClientId}`, { method: "PATCH", body: { name: "Zoe K" } });
  await until(async () => {
    const st = await state();
    return row(st["Strength Log"], workoutIds.strength_ids[0])?.Client === "Zoe K" && row(st.Clients, newClientId)?.Client === "Zoe K";
  }, "rename cascaded");
  const b = await boot();
  assert.ok(b.sessions.filter((s) => s.client === "Zoe K").length >= 1);
});

await test("safety: an emptied tab doesn't wipe the app", async () => {
  const before = (await boot()).strength.length;
  await sheet("/__wipe", { tab: "Strength Log" });
  const res = await api("/api/sync", { method: "POST" });
  assert.equal((await boot()).strength.length, before);
  assert.ok(res.status.warnings.some((w) => /not deleting/.test(w)));
  await sheet("/__reset", {});
});

await test("delete client with cascade removes their logs everywhere", async () => {
  await api("/api/sync", { method: "POST" });
  const b = await boot();
  const maya = b.clients.find((c) => c.name === "Maya");
  const n = b.sessions.filter((s) => s.client === "Maya").length;
  assert.ok(n > 0);
  await api(`/api/clients/${maya.id}?cascade=1`, { method: "DELETE" });
  await until(async () => {
    const st = await state();
    return !row(st.Clients, maya.id) && !st["Session Log"].rows.some((r) => r.values[1] === "Maya");
  }, "cascade delete in sheet");
});

console.log(`\n${passed} sync tests passed`);
