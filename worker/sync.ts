import {
  TAB_LIST,
  hashRow,
  isIsoDate,
  mapHeaders,
  normalizeValue,
  type RowValues,
  type SyncStatus,
  type TabDef,
} from "../shared/schema";
import type { Env } from "./env";
import { applyOps, pullSheet, type CellValue, type OpResult, type SheetOp, type TabSnapshot } from "./sheet";

type DbRow = Record<string, any> & {
  id: string;
  updated_at: string;
  sheet_hash: string | null;
  dirty: number;
  deleted: number;
};

export interface ReconcileStats {
  tab: string;
  inserted: number;
  updated: number;
  deleted: number;
  kept: number;
  warnings: string[];
}

/** Refuse to delete more than this share of a tab in one go: a broken sheet should not wipe the app. */
const MAX_DELETE_SHARE = 0.5;
const MAX_DELETE_FREE = 5;

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** Bump the data revision so open apps know to refetch (they poll the cheap /api/rev). */
export function revStmt(env: Env): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO meta (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1",
  );
}

export async function getRev(env: Env): Promise<number> {
  return Number((await getMeta(env, "rev")) ?? 0);
}

export async function getMeta(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(env: Env, entries: Record<string, string | null>): Promise<void> {
  const stmts = Object.entries(entries).map(([k, v]) =>
    env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

export async function getStatus(env: Env): Promise<SyncStatus> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM meta WHERE key IN ('last_pull_at','last_push_at','last_hook_at','last_error','warnings')",
  ).all<{ key: string; value: string | null }>();
  const m = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  const pending = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM clients WHERE dirty = 1) + (SELECT COUNT(*) FROM sessions WHERE dirty = 1) + (SELECT COUNT(*) FROM strength WHERE dirty = 1) AS n",
  ).first<{ n: number }>();
  return {
    last_pull_at: m.last_pull_at ?? null,
    last_push_at: m.last_push_at ?? null,
    last_hook_at: m.last_hook_at ?? null,
    last_error: m.last_error ?? null,
    warnings: m.warnings ? JSON.parse(m.warnings) : [],
    pending: pending?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Sheet -> D1
// ---------------------------------------------------------------------------

function tabForSheet(name: string): TabDef | undefined {
  return TAB_LIST.find((t) => t.sheet.toLowerCase() === name.trim().toLowerCase());
}

function valuesFromSheet(tab: TabDef, index: Record<string, number>, raw: unknown[]): RowValues {
  const out: RowValues = {};
  for (const col of tab.columns) {
    const i = index[col.key];
    out[col.key] = i === undefined ? null : normalizeValue(col.type, raw[i]);
  }
  return out;
}

function valuesFromResult(tab: TabDef, res: OpResult): RowValues | null {
  if (!res.headers || !res.values) return null;
  const { index } = mapHeaders(tab, res.headers);
  return valuesFromSheet(tab, index, res.values);
}

function insertStmt(env: Env, tab: TabDef, id: string, values: RowValues, updatedAt: string, hash: string | null, dirty = 0) {
  const keys = tab.columns.map((c) => c.key);
  const sql = `INSERT INTO ${tab.table} (id, ${keys.join(", ")}, updated_at, sheet_hash, dirty, deleted)
    VALUES (?, ${keys.map(() => "?").join(", ")}, ?, ?, ?, 0)`;
  return env.DB.prepare(sql).bind(id, ...keys.map((k) => values[k] ?? null), updatedAt, hash, dirty);
}

function overwriteStmt(env: Env, tab: TabDef, id: string, values: RowValues, updatedAt: string, hash: string) {
  const keys = tab.columns.map((c) => c.key);
  const sql = `UPDATE ${tab.table} SET ${keys.map((k) => `${k} = ?`).join(", ")},
    updated_at = ?, sheet_hash = ?, dirty = 0, deleted = 0 WHERE id = ?`;
  return env.DB.prepare(sql).bind(...keys.map((k) => values[k] ?? null), updatedAt, hash, id);
}

async function runBatch(env: Env, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** Bring one tab of D1 in line with a full snapshot of that sheet tab. */
export async function reconcileTab(env: Env, tab: TabDef, snap: TabSnapshot): Promise<ReconcileStats> {
  const stats: ReconcileStats = { tab: tab.sheet, inserted: 0, updated: 0, deleted: 0, kept: 0, warnings: [] };
  if (snap.error) throw new Error(`${tab.sheet}: ${snap.error}`);
  const { index, missing } = mapHeaders(tab, snap.headers);
  if (missing.length) throw new Error(`${tab.sheet}: can't find column(s) ${missing.join(", ")}`);

  const headerMap = Object.fromEntries(Object.entries(index).map(([k, i]) => [k, snap.headers[i]]));
  const now = nowIso();
  const existing = (await env.DB.prepare(`SELECT * FROM ${tab.table}`).all<DbRow>()).results;
  const byId = new Map(existing.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const stmts: D1PreparedStatement[] = [];

  for (const row of snap.rows) {
    if (!row.id) continue;
    if (seen.has(row.id)) {
      stats.warnings.push(`${tab.sheet}: duplicate row id ${row.id}`);
      continue;
    }
    seen.add(row.id);
    const values = valuesFromSheet(tab, index, row.values);
    const hash = hashRow(tab, values);
    const db = byId.get(row.id);

    if (!db) {
      stmts.push(insertStmt(env, tab, row.id, values, row.updated || now, hash));
      stats.inserted++;
      continue;
    }
    if (db.sheet_hash === hash) continue; // sheet unchanged since last sync
    if (db.dirty && !(row.updated && row.updated > db.updated_at)) {
      // Changed on both sides and the app's change is newer: keep it; the push will overwrite the sheet.
      stmts.push(env.DB.prepare(`UPDATE ${tab.table} SET sheet_hash = ? WHERE id = ?`).bind(hash, row.id));
      stats.kept++;
      continue;
    }
    stmts.push(overwriteStmt(env, tab, row.id, values, row.updated || now, hash));
    stats.updated++;
  }

  // Rows that were in the sheet before but are gone now were deleted in the sheet.
  const gone = existing.filter((r) => !seen.has(r.id) && r.sheet_hash !== null);
  const known = existing.filter((r) => r.sheet_hash !== null).length;
  if (gone.length > MAX_DELETE_FREE && gone.length > known * MAX_DELETE_SHARE) {
    stats.warnings.push(
      `${tab.sheet}: ${gone.length} of ${known} rows missing from the sheet; not deleting them. Check the tab, then press Sync now.`,
    );
  } else {
    for (const r of gone) stmts.push(env.DB.prepare(`DELETE FROM ${tab.table} WHERE id = ?`).bind(r.id));
    stats.deleted = gone.length;
  }

  if (stmts.length) stmts.push(revStmt(env));
  await runBatch(env, stmts);
  await setMeta(env, { [`headers:${tab.name}`]: JSON.stringify(headerMap) });
  return stats;
}

export async function reconcileSnapshots(env: Env, snaps: TabSnapshot[]): Promise<ReconcileStats[]> {
  const out: ReconcileStats[] = [];
  for (const snap of snaps) {
    const tab = tabForSheet(snap.tab);
    if (tab) out.push(await reconcileTab(env, tab, snap));
  }
  return out;
}

// ---------------------------------------------------------------------------
// D1 -> Sheet
// ---------------------------------------------------------------------------

function toCell(tab: TabDef, key: string, v: unknown): CellValue {
  const col = tab.columns.find((c) => c.key === key)!;
  if (v === null || v === undefined || v === "") return null;
  if (col.type === "date") return isIsoDate(v) ? { date: v } : String(v);
  if (col.type === "number") return typeof v === "number" ? v : Number(v);
  if (col.type === "auto" && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return String(v);
}

async function headerMapFor(env: Env, tab: TabDef): Promise<Record<string, string>> {
  const saved = await getMeta(env, `headers:${tab.name}`);
  const map: Record<string, string> = saved ? JSON.parse(saved) : {};
  for (const c of tab.columns) map[c.key] ??= c.header;
  return map;
}

/** Write every app change that hasn't reached the sheet yet. */
export async function pushDirty(env: Env): Promise<{ pushed: number; errors: string[] }> {
  const ops: SheetOp[] = [];
  const pending: { tab: TabDef; row: DbRow }[] = [];
  const local: D1PreparedStatement[] = [];

  for (const tab of TAB_LIST) {
    const rows = (
      await env.DB.prepare(`SELECT * FROM ${tab.table} WHERE dirty = 1 ORDER BY updated_at LIMIT 200`).all<DbRow>()
    ).results;
    if (!rows.length) continue;
    const headers = await headerMapFor(env, tab);
    for (const r of rows) {
      if (r.deleted) {
        if (r.sheet_hash === null) {
          // Created and deleted in the app before it ever reached the sheet.
          local.push(env.DB.prepare(`DELETE FROM ${tab.table} WHERE id = ?`).bind(r.id));
          continue;
        }
        ops.push({ op: "delete", tab: tab.sheet, id: r.id });
      } else {
        const values: Record<string, CellValue> = {};
        for (const c of tab.columns) values[headers[c.key]] = toCell(tab, c.key, r[c.key]);
        ops.push({ op: "upsert", tab: tab.sheet, id: r.id, updated: r.updated_at, values });
      }
      pending.push({ tab, row: r });
    }
  }
  await runBatch(env, local);
  if (!ops.length) return { pushed: 0, errors: [] };

  const results = await applyOps(env, ops);
  const stmts: D1PreparedStatement[] = [];
  const errors: string[] = [];
  results.forEach((res, i) => {
    const { tab, row } = pending[i];
    if (!res || !res.ok) {
      errors.push(`${tab.sheet} ${row.id}: ${res?.error ?? "no result"}`);
      return;
    }
    if (ops[i].op === "delete") {
      stmts.push(env.DB.prepare(`DELETE FROM ${tab.table} WHERE id = ? AND deleted = 1 AND updated_at = ?`).bind(row.id, row.updated_at));
      return;
    }
    const sheetValues = valuesFromResult(tab, res);
    if (!sheetValues) return;
    const hash = hashRow(tab, sheetValues);
    if (res.conflict) {
      // Someone edited this row in the sheet after the app change: the sheet wins.
      stmts.push(overwriteStmt(env, tab, row.id, sheetValues, res.updated || nowIso(), hash));
    } else {
      // Only clear dirty if the row wasn't changed again while we were writing.
      stmts.push(
        env.DB.prepare(`UPDATE ${tab.table} SET dirty = 0, sheet_hash = ? WHERE id = ? AND updated_at = ?`).bind(hash, row.id, row.updated_at),
      );
    }
  });
  if (stmts.length) stmts.push(revStmt(env));
  await runBatch(env, stmts);
  return { pushed: results.filter((r) => r?.ok).length, errors };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function recordResult(env: Env, kind: "pull" | "push" | "hook", warnings: string[], error?: string | null) {
  const entries: Record<string, string | null> = { [`last_${kind}_at`]: nowIso() };
  if (error !== undefined) entries.last_error = error;
  if (kind !== "push") entries.warnings = JSON.stringify(warnings);
  await setMeta(env, entries);
}

export async function pullAll(env: Env): Promise<ReconcileStats[]> {
  const snaps = await pullSheet(env);
  const stats = await reconcileSnapshots(env, snaps);
  await recordResult(env, "pull", stats.flatMap((s) => s.warnings), null);
  return stats;
}

export async function syncNow(env: Env): Promise<{ stats?: ReconcileStats[]; pushed?: number; error?: string }> {
  try {
    const stats = await pullAll(env);
    const push = await pushDirty(env);
    await recordResult(env, "push", [], push.errors.length ? push.errors.join("; ") : null);
    return { stats, pushed: push.pushed, error: push.errors[0] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setMeta(env, { last_error: msg });
    return { error: msg };
  }
}

/** Push in the background after an app change; failures stay dirty and are retried by cron. */
export async function pushSoon(env: Env): Promise<void> {
  try {
    const push = await pushDirty(env);
    await recordResult(env, "push", [], push.errors.length ? push.errors.join("; ") : null);
  } catch (err) {
    await setMeta(env, { last_error: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleHook(env: Env, snaps: TabSnapshot[]): Promise<ReconcileStats[]> {
  const stats = await reconcileSnapshots(env, snaps);
  await recordResult(env, "hook", stats.flatMap((s) => s.warnings));
  return stats;
}
