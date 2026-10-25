import { Activity, House, Plus, Settings, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { dismiss, useToasts } from "../lib/toast";
import { tap } from "../lib/native";
import { cx } from "./ui";

const TABS = [
  { href: "/", label: "Today", icon: House },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/log", label: "Log", icon: Plus, primary: true },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function BottomNav() {
  const [path] = useLocation();
  if (path.startsWith("/log")) return null;
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/92 backdrop-blur-xl"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="mx-auto flex max-w-xl items-stretch justify-around px-2">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          const Icon = t.icon;
          if ("primary" in t) {
            return (
              <Link key={t.href} href={t.href} onClick={tap} className="flex flex-1 items-center justify-center py-2" aria-label="Log a workout">
                <span className="flex size-13 items-center justify-center rounded-full bg-accent text-accent-ink shadow-card active:scale-95">
                  <Icon size={26} strokeWidth={2.4} />
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={tap}
              className={cx("flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11.5px] font-semibold", active ? "text-fg" : "text-fg-3")}
            >
              <Icon size={23} strokeWidth={active ? 2.3 : 1.9} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Toasts() {
  const toasts = useToasts();
  const [path] = useLocation();
  const bottom = path.startsWith("/log") ? "calc(var(--safe-bottom) + 96px)" : "calc(var(--safe-bottom) + 88px)";
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" style={{ bottom }} aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "anim-rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[14.5px] font-medium shadow-card",
            t.tone === "error" ? "bg-bad text-bg" : "bg-fg text-bg",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
