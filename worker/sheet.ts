import type { Env } from "./env";

// Wire format shared with apps-script/Code.gs.

export interface SheetRow {
  id: string;
  updated: string;
  row?: number;
  values: unknown[];
}

export interface TabSnapshot {
  tab: string;
  headers: string[];
  rows: SheetRow[];
  error?: string;
}

export type CellValue = string | number | null | { date: string };

export interface SheetOp {
  op: "upsert" | "delete";
  tab: string;
  id: string;
  updated?: string;
  values?: Record<string, CellValue>;
}

export interface OpResult {
  id: string;
  ok: boolean;
  error?: string;
  deleted?: boolean;
  conflict?: boolean;
  headers?: string[];
  values?: unknown[];
  updated?: string;
}

export class SheetError extends Error {}

async function callScript<T>(env: Env, body: Record<string, unknown>): Promise<T> {
  if (!env.SHEET_SCRIPT_URL || !env.SHEET_SECRET) {
    throw new SheetError("Sheet not connected: SHEET_SCRIPT_URL / SHEET_SECRET are not set");
  }
  const res = await fetch(env.SHEET_SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, secret: env.SHEET_SECRET }),
    redirect: "follow",
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SheetError(`Sheet script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
  if (!data.ok) throw new SheetError(`Sheet script error: ${data.error ?? "unknown"}`);
  return data as T;
}

export async function pullSheet(env: Env): Promise<TabSnapshot[]> {
  const data = await callScript<{ tabs: TabSnapshot[] }>(env, { action: "pull" });
  return data.tabs;
}

export async function applyOps(env: Env, ops: SheetOp[]): Promise<OpResult[]> {
  if (!ops.length) return [];
  const data = await callScript<{ results: OpResult[] }>(env, { action: "apply", ops });
  return data.results;
}
