import type { Bootstrap, Client, Session, StrengthEntry } from "../../../shared/schema";
import { daysAgo, startOfWeekIso, todayIso } from "./format";

export type Tone = "ok" | "bad" | "warn" | "neutral";

export function paymentTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  if (/not paid|unpaid|overdue|due\b|owes/i.test(status)) return "bad";
  if (/not discussed/i.test(status)) return "neutral";
  if (/paid/i.test(status)) return "ok";
  return "warn";
}

export interface ClientView extends Client {
  sessions: Session[];
  strength: StrengthEntry[];
  sessionCount: number;
  weekCount: number;
  monthCount: number;
  lastSession: string | null;
  lastWorkout: string | null;
  tone: Tone;
}

const byDateDesc = <T extends { date: string | null; updated_at: string }>(a: T, b: T) =>
  (b.date ?? "").localeCompare(a.date ?? "") || b.updated_at.localeCompare(a.updated_at);

export function deriveClients(boot: Bootstrap): ClientView[] {
  const week = startOfWeekIso();
  const month = todayIso().slice(0, 7);
  const sessions = new Map<string, Session[]>();
  const strength = new Map<string, StrengthEntry[]>();
  for (const s of boot.sessions) if (s.client) (sessions.get(s.client) ?? sessions.set(s.client, []).get(s.client)!).push(s);
  for (const s of boot.strength) if (s.client) (strength.get(s.client) ?? strength.set(s.client, []).get(s.client)!).push(s);

  return boot.clients
    .map((c) => {
      const ss = (sessions.get(c.name) ?? []).sort(byDateDesc);
      // Date only: the sort is stable, so exercises keep the order they were logged in.
      const st = (strength.get(c.name) ?? []).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      const withFocus = ss.find((s) => s.focus) ?? null;
      return {
        ...c,
        sessions: ss,
        strength: st,
        sessionCount: ss.length,
        weekCount: ss.filter((s) => (s.date ?? "") >= week).length,
        monthCount: ss.filter((s) => (s.date ?? "").startsWith(month)).length,
        lastSession: ss[0]?.date ?? null,
        lastWorkout: st[0]?.workout ?? withFocus?.focus ?? null,
        tone: paymentTone(c.payment_status),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Most recent entry per exercise for one client. */
export function lastByExercise(entries: StrengthEntry[]): Map<string, StrengthEntry> {
  const out = new Map<string, StrengthEntry>();
  for (const e of [...entries].sort(byDateDesc)) {
    if (e.exercise && !out.has(e.exercise)) out.set(e.exercise, e);
  }
  return out;
}

export interface ExerciseProgress {
  exercise: string;
  points: { date: string; kg: number }[];
  first: { date: string; kg: number };
  latest: { date: string; kg: number };
  change: number;
}

/** Weighted entries grouped by exercise, oldest → newest (matches the sheet's Progress tab). */
export function progressFor(entries: StrengthEntry[]): ExerciseProgress[] {
  const groups = new Map<string, { date: string; kg: number }[]>();
  for (const e of entries) {
    if (!e.exercise || e.weight_kg === null || e.weight_kg === undefined || !e.date) continue;
    (groups.get(e.exercise) ?? groups.set(e.exercise, []).get(e.exercise)!).push({ date: e.date, kg: e.weight_kg });
  }
  return [...groups.entries()]
    .map(([exercise, pts]) => {
      const points = pts.sort((a, b) => a.date.localeCompare(b.date));
      const first = points[0];
      const latest = points[points.length - 1];
      return { exercise, points, first, latest, change: latest.kg - first.kg };
    })
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.exercise.localeCompare(b.exercise));
}

/** Every exercise name seen in the log, most used first. */
export function knownExercises(entries: StrengthEntry[]): string[] {
  const n = new Map<string, number>();
  for (const e of entries) if (e.exercise) n.set(e.exercise, (n.get(e.exercise) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export interface DayGroup {
  date: string;
  items: Array<
    | { kind: "session"; session: Session }
    | { kind: "workout"; key: string; client: string; workout: string | null; entries: StrengthEntry[]; session?: Session }
  >;
}

/** Activity feed: sessions plus weight entries grouped per client/day/workout. */
export function activity(boot: Bootstrap, client?: string): DayGroup[] {
  const days = new Map<string, DayGroup>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d, items: [] }).get(d)!;
  const workouts = new Map<string, Extract<DayGroup["items"][number], { kind: "workout" }>>();
  for (const s of boot.strength) {
    if (!s.date || (client && s.client !== client)) continue;
    const key = `${s.date}|${s.client}|${s.workout ?? ""}`;
    let w = workouts.get(key);
    if (!w) {
      w = { kind: "workout", key, client: s.client ?? "", workout: s.workout, entries: [] };
      workouts.set(key, w);
      day(s.date).items.push(w);
    }
    w.entries.push(s);
  }
  for (const s of boot.sessions) {
    if (!s.date || (client && s.client !== client)) continue;
    // A session logged with a workout shows as one item.
    const w = workouts.get(`${s.date}|${s.client}|${s.focus ?? ""}`);
    if (w && !w.session) w.session = s;
    else day(s.date).items.unshift({ kind: "session", session: s });
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function needsAttention(clients: ClientView[]): Array<{ client: ClientView; reason: string; tone: Tone }> {
  const out: Array<{ client: ClientView; reason: string; tone: Tone }> = [];
  for (const c of clients) {
    if (c.tone === "bad") out.push({ client: c, reason: c.payment_status ?? "Not paid", tone: "bad" });
    const idle = daysAgo(c.lastSession);
    if (idle !== null && idle >= 7) out.push({ client: c, reason: `No session for ${idle} days`, tone: "warn" });
  }
  return out;
}
