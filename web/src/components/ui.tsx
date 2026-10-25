import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import type { Tone } from "../lib/derive";
import { initials } from "../lib/format";
import { tap } from "../lib/native";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- Layout --------------------------------------------------------------------------------

export function Page({
  title,
  eyebrow,
  action,
  onBack,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-32" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
      <header className="mb-5 pt-2">
        <div className="flex min-h-10 items-center justify-between gap-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="-ml-2 flex h-10 items-center gap-1 rounded-full pr-3 pl-1 text-[15px] font-medium text-fg-2 active:bg-surface-2"
            >
              <ChevronLeft size={22} strokeWidth={2} /> Back
            </button>
          ) : (
            <div className="text-[12px] font-semibold tracking-[0.12em] text-fg-3 uppercase">{eyebrow}</div>
          )}
          <div className="flex items-center gap-1">{action}</div>
        </div>
        {onBack && eyebrow && <div className="mt-2 text-[12px] font-semibold tracking-[0.12em] text-fg-3 uppercase">{eyebrow}</div>}
        <h1 className="mt-1 font-serif text-[38px] leading-[1.05] font-medium tracking-[-0.02em] text-fg">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-7", className)}>
      {(title || action) && (
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <h2 className="text-[13px] font-semibold tracking-[0.08em] text-fg-3 uppercase">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "block w-full rounded-[22px] border border-line bg-surface text-left shadow-card",
        onClick && "transition-transform active:scale-[0.985] active:bg-surface-2",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

// --- Bits ----------------------------------------------------------------------------------

const toneClass: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  bad: "bg-bad-soft text-bad",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-surface-2 text-fg-2",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[12px] font-semibold", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-serif font-medium text-accent-soft-ink"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initials(name) || "?"}
    </div>
  );
}

export function PendingDot({ show }: { show?: boolean }) {
  if (!show) return null;
  return <span title="Saving to the sheet…" className="inline-block size-2 shrink-0 animate-pulse rounded-full bg-accent" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed border-line px-6 py-10 text-center">
      <div className="font-serif text-[22px] text-fg">{title}</div>
      {children && <div className="mt-1.5 text-[15px] text-fg-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[20px] border border-line bg-surface px-4 py-3.5 shadow-card">
      <div className="truncate text-[12.5px] font-medium text-fg-3">{label}</div>
      <div className="tabular mt-1 truncate text-[28px] leading-none font-semibold tracking-[-0.02em] text-fg">{value}</div>
      {sub && <div className="mt-1.5 truncate text-[12.5px] text-fg-2">{sub}</div>}
    </div>
  );
}

// --- Buttons -------------------------------------------------------------------------------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg" | "sm";
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", icon, className, children, onClick, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        tap();
        onClick?.(e);
      }}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background-color,opacity] select-none active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100",
        size === "lg" && "h-14 px-6 text-[16.5px]",
        size === "md" && "h-12 px-5 text-[15.5px]",
        size === "sm" && "h-9 px-3.5 text-[14px]",
        variant === "primary" && "bg-accent text-accent-ink",
        variant === "secondary" && "border border-line bg-surface text-fg active:bg-surface-2",
        variant === "ghost" && "text-fg-2 active:bg-surface-2",
        variant === "danger" && "bg-bad-soft text-bad",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  onClick,
  primary,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; primary?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      onClick={(e) => {
        tap();
        onClick?.(e);
      }}
      className={cx(
        "flex size-11 items-center justify-center rounded-full",
        primary ? "bg-accent text-accent-ink active:scale-95" : "text-fg active:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- Forms ---------------------------------------------------------------------------------

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[13px] font-semibold text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block px-1 text-[12.5px] text-fg-3">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full rounded-2xl border border-line bg-surface-2 px-4 text-[16px] text-fg placeholder:text-fg-3 outline-none transition-colors focus:border-accent focus:bg-surface";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(inputBase, "h-13", className)} />;
});

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(inputBase, "min-h-24 resize-none py-3 leading-snug", className)} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("flex gap-1 rounded-full bg-surface-2 p-1", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => {
            tap();
            onChange(o.value);
          }}
          className={cx(
            "h-10 flex-1 truncate rounded-full px-3 text-[14.5px] font-semibold transition-colors",
            o.value === value ? "bg-raised text-fg shadow-card" : "text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            tap();
            onChange(o.value);
          }}
          className={cx(
            "h-10 shrink-0 rounded-full border px-4 text-[14.5px] font-semibold transition-colors",
            o.value === value ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Weight stepper: big value in the middle, ± buttons with a 2.5kg step. */
export function Stepper({
  value,
  onChange,
  step = 2.5,
  placeholder = "—",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  placeholder?: string;
}) {
  const bump = (d: number) => {
    tap();
    const base = value ?? 0;
    const next = Math.max(0, Math.round((base + d) * 100) / 100);
    onChange(next === 0 && d < 0 ? null : next);
  };
  return (
    <div className="flex h-12 items-center rounded-full bg-surface-2">
      <button aria-label="Less" onClick={() => bump(-step)} className="flex size-12 items-center justify-center rounded-full text-fg-2 active:bg-surface-3">
        <Minus size={20} />
      </button>
      <input
        inputMode="decimal"
        value={value === null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(",", ".");
          if (t === "") return onChange(null);
          const n = Number(t);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="tabular h-12 w-16 min-w-0 flex-1 bg-transparent text-center text-[20px] font-semibold text-fg outline-none placeholder:text-fg-3"
      />
      <span className="-ml-1 pr-1 text-[14px] font-medium text-fg-3">kg</span>
      <button aria-label="More" onClick={() => bump(step)} className="flex size-12 items-center justify-center rounded-full text-fg-2 active:bg-surface-3">
        <Plus size={20} />
      </button>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}
