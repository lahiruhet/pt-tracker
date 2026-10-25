import { Hono } from "hono";
import {
  TABS,
  isIsoDate,
  normalizeValue,
  type Bootstrap,
  type RowValues,
  type TabDef,
  type TabName,
} from "../shared/schema";
import { accessEmail, safeEqual } from "./auth";
import type { Env } from "./env";
import type { TabSnapshot } from "./sheet";
import { getRev, getStatus, handleHook, newId, nowIso, pushSoon, revStmt, syncNow } from "./sync";

type Ctx = { Bindings: Env; Variables: { email: string } };

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const app = new Hono<Ctx>();

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  return c.json({ error: err.message }, status as 400);
});

// --- Sheet -> app hook (Cloudflare Access bypasses this path; the shared secret guards it) ---------

app.post("/api/hook/sheet", async (c) => {
  const secret = c.req.header("x-sheet-secret") ?? "";
  if (!c.env.SHEET_SECRET || !safeEqual(secret, c.env.SHEET_SECRET)) throw new HttpError(401, "bad secret");
  const body = await c.req.json<{ tabs: TabSnapshot[] }>();
  const stats = await handleHook(c.env, body.tabs ?? []);
  return c.json({ ok: true, stats });
});

// --- Everything else needs a signed-in, allowed user -----------------------------------------

app.use("/api/*", async (c, next) => {
  const email = await accessEmail(c.req.raw, c.env);
  if (!email) throw new HttpError(401, "Not signed in");
  c.set("email", email);
  await next();
});

function displayName(env: Env, email: string): string | null {
  for (const pair of (env.DISPLAY_NAMES ?? "").split(",")) {
    const [e, name] = pair.split("=").map((s) => s.trim());
    if (e && name && e.toLowerCase() === email.toLowerCase()) return name;
  }
  return null;
}

function publicRow(r: Record<string, any>) {
  const { sheet_hash, dirty, deleted, ...rest } = r;
  return { ...rest, pending: dirty === 1 };
}

app.get("/api/bootstrap", async (c) => {
  const db = c.env.DB;
  const [clients, sessions, strength] = await db.batch<Record<string, any>>([
    db.prepare("SELECT * FROM clients WHERE deleted = 0 ORDER BY name COLLATE NOCASE"),
    db.prepare("SELECT * FROM sessions WHERE deleted = 0 ORDER BY date DESC, rowid DESC"),
    // Within a day keep the order exercises were logged in (sheet row order).
    db.prepare("SELECT * FROM strength WHERE deleted = 0 ORDER BY date DESC, rowid ASC"),
  ]);
  const body: Bootstrap = {
    clients: clients.results.map(publicRow) as any,
    sessions: sessions.results.map(publicRow) as any,
    strength: strength.results.map(publicRow) as any,
    sync: await getStatus(c.env),
    rev: await getRev(c.env),
    me: c.get("email"),
    me_name: displayName(c.env, c.get("email")),
    sheet_url: c.env.SHEET_URL ?? null,
  };
  c.header("cache-control", "no-store");
  return c.json(body);
});

app.get("/api/sync", async (c) => c.json(await getStatus(c.env)));

/** Cheap change check for polling: one row read. */
app.get("/api/rev", async (c) => {
  c.header("cache-control", "no-store");
  return c.json({ rev: await getRev(c.env) });
});

app.post("/api/sync", async (c) => {
  const result = await syncNow(c.env);
  return c.json({ ...result, status: await getStatus(c.env) });
});

// --- CRUD ----------------------------------------------------------------------------------

function tabFor(name: string): TabDef {
  const tab = TABS[name as TabName];
  if (!tab) throw new HttpError(404, "Unknown table");
  return tab;
}

/** Keep only known fields, normalised. On create, every required field must be present. */
function clean(tab: TabDef, body: Record<string, unknown>, partial: boolean): RowValues {
  const out: RowValues = {};
  for (const col of tab.columns) {
    if (!(col.key in body)) {
      if (!partial) out[col.key] = null;
      continue;
    }
    const v = normalizeValue(col.type, body[col.key]);
    if (col.type === "date" && v !== null && !isIsoDate(v)) throw new HttpError(400, `${col.header} must be YYYY-MM-DD`);
    out[col.key] = v;
  }
  for (const col of tab.columns) {
    if (col.required && (partial ? col.key in out && out[col.key] === null : out[col.key] === null)) {
      throw new HttpError(400, `${col.header} is required`);
    }
  }
  return out;
}

async function getRow(env: Env, tab: TabDef, id: string) {
  const row = await env.DB.prepare(`SELECT * FROM ${tab.table} WHERE id = ? AND deleted = 0`).bind(id).first();
  if (!row) throw new HttpError(404, "Not found");
  return row;
}

async function assertUniqueName(env: Env, name: string, exceptId?: string) {
  const hit = await env.DB.prepare("SELECT id FROM clients WHERE name = ? COLLATE NOCASE AND deleted = 0 AND id != ?")
    .bind(name, exceptId ?? "")
    .first();
  if (hit) throw new HttpError(409, `A client called ${name} already exists`);
}

/** The app may send its own id so a retried request (e.g. after being offline) can't create a duplicate. */
function pickId(raw: unknown): string {
  return typeof raw === "string" && /^[a-z0-9]{8,32}$/i.test(raw) ? raw : newId();
}

function insertRow(env: Env, tab: TabDef, id: string, values: RowValues, now: string) {
  const keys = tab.columns.map((c) => c.key);
  return env.DB.prepare(
    `INSERT INTO ${tab.table} (id, ${keys.join(", ")}, updated_at, sheet_hash, dirty, deleted)
     VALUES (?, ${keys.map(() => "?").join(", ")}, ?, NULL, 1, 0)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(id, ...keys.map((k) => values[k] ?? null), now);
}

app.post("/api/workouts", async (c) => {
  const body = await c.req.json<{
    client: string;
    date: string;
    workout?: string;
    entries: Array<Record<string, unknown>>;
    session?: { id?: string; focus?: string; notes?: string } | null;
  }>();
  if (!body.client || !isIsoDate(body.date)) throw new HttpError(400, "client and date are required");
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (const e of body.entries ?? []) {
    const values = clean(TABS.strength, { ...e, client: body.client, date: body.date, workout: body.workout ?? e.workout }, false);
    const id = pickId(e.id);
    ids.push(id);
    stmts.push(insertRow(c.env, TABS.strength, id, values, now));
  }
  let sessionId: string | null = null;
  if (body.session) {
    sessionId = pickId(body.session.id);
    const values = clean(TABS.sessions, { client: body.client, date: body.date, ...body.session }, false);
    stmts.push(insertRow(c.env, TABS.sessions, sessionId, values, now));
  }
  if (!stmts.length) throw new HttpError(400, "Nothing to save");
  await c.env.DB.batch([...stmts, revStmt(c.env)]);
  c.executionCtx.waitUntil(pushSoon(c.env));
  return c.json({ ok: true, strength_ids: ids, session_id: sessionId });
});

app.post("/api/:tab", async (c) => {
  const tab = tabFor(c.req.param("tab"));
  const body = await c.req.json<Record<string, unknown>>();
  const id = pickId(body.id);
  const existing = await c.env.DB.prepare(`SELECT * FROM ${tab.table} WHERE id = ?`).bind(id).first();
  if (existing) return c.json(publicRow(existing)); // already saved (retried request)
  const values = clean(tab, body, false);
  if (tab.name === "clients") await assertUniqueName(c.env, String(values.name));
  const now = nowIso();
  await c.env.DB.batch([insertRow(c.env, tab, id, values, now), revStmt(c.env)]);
  c.executionCtx.waitUntil(pushSoon(c.env));
  return c.json(publicRow(await getRow(c.env, tab, id)), 201);
});

app.patch("/api/:tab/:id", async (c) => {
  const tab = tabFor(c.req.param("tab"));
  const id = c.req.param("id");
  const before = await getRow(c.env, tab, id);
  const values = clean(tab, await c.req.json(), true);
  const keys = Object.keys(values);
  if (!keys.length) return c.json(publicRow(before));
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE ${tab.table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ?, dirty = 1 WHERE id = ?`).bind(
      ...keys.map((k) => values[k]),
      now,
      id,
    ),
  ];
  // Renaming a client renames them on every log row too (the sheet links rows by name).
  if (tab.name === "clients" && values.name && values.name !== before.name) {
    await assertUniqueName(c.env, String(values.name), id);
    for (const t of [TABS.sessions, TABS.strength]) {
      stmts.push(
        c.env.DB.prepare(`UPDATE ${t.table} SET client = ?, updated_at = ?, dirty = 1 WHERE client = ? AND deleted = 0`).bind(
          values.name,
          now,
          before.name,
        ),
      );
    }
  }
  await c.env.DB.batch([...stmts, revStmt(c.env)]);
  c.executionCtx.waitUntil(pushSoon(c.env));
  return c.json(publicRow(await getRow(c.env, tab, id)));
});

app.delete("/api/:tab/:id", async (c) => {
  const tab = tabFor(c.req.param("tab"));
  const id = c.req.param("id");
  const row = await getRow(c.env, tab, id);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE ${tab.table} SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?`).bind(now, id),
  ];
  if (tab.name === "clients" && c.req.query("cascade") === "1") {
    for (const t of [TABS.sessions, TABS.strength]) {
      stmts.push(
        c.env.DB.prepare(`UPDATE ${t.table} SET deleted = 1, dirty = 1, updated_at = ? WHERE client = ? AND deleted = 0`).bind(now, row.name),
      );
    }
  }
  await c.env.DB.batch([...stmts, revStmt(c.env)]);
  c.executionCtx.waitUntil(pushSoon(c.env));
  return c.json({ ok: true });
});

app.all("/api/*", () => {
  throw new HttpError(404, "Not found");
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncNow(env).then((r) => r.error && console.warn("sync:", r.error)));
  },
} satisfies ExportedHandler<Env>;
