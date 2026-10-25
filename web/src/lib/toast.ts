import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
const subs = new Set<() => void>();
let seq = 0;

function emit() {
  for (const s of subs) s();
}

export function toast(text: string, opts: Partial<Omit<Toast, "id" | "text">> = {}): void {
  const t: Toast = { id: ++seq, text, tone: opts.tone ?? "info", action: opts.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), t.action ? 6000 : 3200);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => toasts,
  );
}
