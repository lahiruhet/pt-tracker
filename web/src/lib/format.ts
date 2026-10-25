const DAY = 86_400_000;

export function todayIso(): string {
  return isoOf(new Date());
}

export function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from iso to today (positive = in the past). */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return Math.round((parseIso(todayIso()).getTime() - parseIso(iso).getTime()) / DAY);
}

export function relDay(iso: string | null | undefined): string {
  const n = daysAgo(iso);
  if (n === null) return iso ?? "";
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n === -1) return "Tomorrow";
  if (n > 1 && n < 7) return `${n} days ago`;
  if (n < 0 && n > -7) return `In ${-n} days`;
  return shortDate(iso!);
}

/** "Today", "Yesterday", or "Sat 24 Oct". */
export function dayLabel(iso: string): string {
  const n = daysAgo(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  return `${weekday(iso)} ${shortDate(iso)}`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? "";
  const d = parseIso(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function longDate(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function weekday(iso: string): string {
  return parseIso(iso).toLocaleDateString("en-GB", { weekday: "short" });
}

export function startOfWeekIso(): string {
  const d = parseIso(todayIso());
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return isoOf(d);
}

export function kg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}kg`;
}

export function signedKg(n: number): string {
  const v = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  return n > 0 ? `+${v}` : n < 0 ? `−${v.slice(1)}` : "0";
}

export function money(price: string | null | undefined): string {
  if (!price) return "";
  return /^\d+(\.\d+)?$/.test(price) ? `${Number(price).toLocaleString("en-US")} AED` : price;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
