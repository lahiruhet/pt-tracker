// One definition per synced sheet tab. Columns are matched to the sheet by header text,
// so reordering columns in the sheet is safe. Formula columns (Sessions in chat, Last session,
// the Progress tab) are deliberately absent: the app computes those itself.

export type ColType = "text" | "date" | "number" | "auto"; // auto = number when numeric, else text

export interface ColumnDef {
  key: string;
  header: string;
  type: ColType;
  aliases?: string[];
  required?: boolean;
}

export type TabName = "clients" | "sessions" | "strength";

export interface TabDef {
  name: TabName;
  sheet: string;
  table: string;
  columns: ColumnDef[];
}

export const TABS: Record<TabName, TabDef> = {
  clients: {
    name: "clients",
    sheet: "Clients",
    table: "clients",
    columns: [
      { key: "name", header: "Client", type: "text", required: true, aliases: ["Name"] },
      { key: "start_date", header: "Start date", type: "date" },
      { key: "goal", header: "Goal", type: "text" },
      { key: "package", header: "Package", type: "text" },
      { key: "price", header: "Price (AED/month)", type: "auto", aliases: ["Price"] },
      { key: "last_payment", header: "Last payment", type: "date" },
      { key: "payment_status", header: "Payment status", type: "text" },
      { key: "schedule", header: "Schedule / next session", type: "text", aliases: ["Schedule"] },
      { key: "notes", header: "Notes", type: "text" },
    ],
  },
  sessions: {
    name: "sessions",
    sheet: "Session Log",
    table: "sessions",
    columns: [
      { key: "date", header: "Date", type: "date", required: true },
      { key: "client", header: "Client", type: "text", required: true },
      { key: "focus", header: "Session / focus", type: "text", aliases: ["Focus", "Session"] },
      { key: "notes", header: "Evidence in chat", type: "text", aliases: ["Notes"] },
    ],
  },
  strength: {
    name: "strength",
    sheet: "Strength Log",
    table: "strength",
    columns: [
      { key: "date", header: "Date", type: "date", required: true },
      { key: "client", header: "Client", type: "text", required: true },
      { key: "workout", header: "Workout", type: "text" },
      { key: "exercise", header: "Exercise", type: "text", required: true },
      { key: "load_text", header: "Load as sent", type: "text", aliases: ["Load"] },
      { key: "weight_kg", header: "Weight (kg)", type: "number", aliases: ["Weight"] },
      { key: "sets_reps", header: "Sets x reps", type: "text", aliases: ["Sets"] },
    ],
  },
};

export const TAB_LIST: TabDef[] = [TABS.clients, TABS.sessions, TABS.strength];

export type Value = string | number | null;
export type RowValues = Record<string, Value>;

export interface Client {
  id: string;
  name: string;
  start_date: string | null;
  goal: string | null;
  package: string | null;
  price: string | null;
  last_payment: string | null;
  payment_status: string | null;
  schedule: string | null;
  notes: string | null;
  updated_at: string;
  pending?: boolean;
}

export interface Session {
  id: string;
  date: string | null;
  client: string | null;
  focus: string | null;
  notes: string | null;
  updated_at: string;
  pending?: boolean;
}

export interface StrengthEntry {
  id: string;
  date: string | null;
  client: string | null;
  workout: string | null;
  exercise: string | null;
  load_text: string | null;
  weight_kg: number | null;
  sets_reps: string | null;
  updated_at: string;
  pending?: boolean;
}

export interface SyncStatus {
  last_pull_at: string | null;
  last_push_at: string | null;
  last_hook_at: string | null;
  last_error: string | null;
  warnings: string[];
  pending: number;
}

export interface Bootstrap {
  clients: Client[];
  sessions: Session[];
  strength: StrengthEntry[];
  sync: SyncStatus;
  rev: number;
  me: string | null;
  me_name: string | null;
  sheet_url: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE.test(v);
}

/** Normalise a raw cell (from the sheet or the API) to what we store in D1. */
export function normalizeValue(type: ColType, raw: unknown): Value {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s === "") return null;
    if (type === "number") {
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return s;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (type === "number") return raw;
    return String(raw);
  }
  if (typeof raw === "boolean") return type === "number" ? Number(raw) : String(raw);
  return String(raw);
}

export function normalizeRow(tab: TabDef, input: Record<string, unknown>): RowValues {
  const out: RowValues = {};
  for (const col of tab.columns) out[col.key] = normalizeValue(col.type, input[col.key]);
  return out;
}

/** Stable hash of a row's values, used to tell whether the sheet changed since the last sync. */
export function hashRow(tab: TabDef, values: RowValues): string {
  const s = JSON.stringify(tab.columns.map((c) => values[c.key] ?? null));
  // cyrb53
  let h1 = 0xdeadbeef ^ 0,
    h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Map sheet headers to column keys. Returns key -> header index. */
export function mapHeaders(tab: TabDef, headers: string[]): { index: Record<string, number>; missing: string[] } {
  const norm = (h: string) => h.trim().toLowerCase();
  const pos = new Map<string, number>();
  headers.forEach((h, i) => {
    if (typeof h === "string" && h.trim() && !pos.has(norm(h))) pos.set(norm(h), i);
  });
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const col of tab.columns) {
    const names = [col.header, ...(col.aliases ?? [])];
    const hit = names.map((n) => pos.get(norm(n))).find((i) => i !== undefined);
    if (hit === undefined) {
      if (col.required) missing.push(col.header);
    } else index[col.key] = hit;
  }
  return { index, missing };
}
