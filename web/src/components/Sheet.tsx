import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Each open sheet owns one history entry, so the Android back button (and browser back) closes
// the top sheet instead of leaving the screen. Closing a sheet from the UI pops its entry.
const stack: string[] = [];
const closers = new Map<string, () => void>();
let pendingBacks = 0;
const pendingClose = new Map<string, ReturnType<typeof setTimeout>>();
let waiting: Array<() => void> = [];

function flushWaiting() {
  const fns = waiting;
  waiting = [];
  fns.forEach((f) => f());
}

if (typeof window !== "undefined") {
  addEventListener("popstate", () => {
    if (pendingBacks > 0) {
      pendingBacks--;
      if (pendingBacks === 0) flushWaiting();
      return;
    }
    const top = stack.pop();
    if (top) closers.get(top)?.();
  });
}

/** Run fn once every closing sheet has popped its history entry (use before navigating). */
export function afterSheetsClose(fn: () => void): void {
  setTimeout(() => (pendingBacks === 0 ? fn() : waiting.push(fn)), 30);
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const scheduled = pendingClose.get(id);
    if (scheduled !== undefined) {
      // Re-mounted straight after a cleanup (React StrictMode): keep the existing history entry.
      clearTimeout(scheduled);
      pendingClose.delete(id);
    } else {
      stack.push(id);
      history.pushState({ ...(history.state ?? {}), sheet: id }, "");
    }
    closers.set(id, () => closeRef.current());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stack[stack.length - 1] === id && closeRef.current();
    addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", onKey);
      closers.delete(id);
      if (!stack.includes(id)) {
        if (!stack.length) document.body.style.overflow = "";
        return; // closed by the back button: its entry is already gone
      }
      pendingClose.set(
        id,
        setTimeout(() => {
          pendingClose.delete(id);
          const i = stack.indexOf(id);
          if (i < 0) return;
          // Closed from the UI: pop our history entry.
          stack.splice(i, 1);
          pendingBacks++;
          history.back();
          if (!stack.length) document.body.style.overflow = "";
        }, 0),
      );
    };
  }, [open, id]);

  const close = () => closeRef.current();

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-[var(--scrim)]" onClick={close} />
      <div
        className="anim-sheet relative mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-[28px] border-t border-line bg-bg shadow-card"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="flex items-center justify-between px-5 pt-3">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-surface-3" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-3">
          <h2 className="font-serif text-[26px] leading-tight font-medium tracking-[-0.01em]">{title}</h2>
          <button onClick={close} aria-label="Close" className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-fg-2 active:bg-surface-2">
            <X size={22} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
