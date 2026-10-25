import { useMemo, useState } from "react";
import { Dumbbell, NotebookPen } from "lucide-react";
import type { Bootstrap, Session, StrengthEntry } from "../../../shared/schema";
import { SessionSheet, StrengthSheet } from "../components/Forms";
import { Button, Card, Chips, Empty, Page, PendingDot } from "../components/ui";
import { activity } from "../lib/derive";
import { dayLabel, kg } from "../lib/format";

const PAGE = 14;

export function ActivityScreen({ boot }: { boot: Bootstrap }) {
  const [client, setClient] = useState<string>("__all");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [entry, setEntry] = useState<StrengthEntry | null>(null);
  const days = useMemo(() => activity(boot, client === "__all" ? undefined : client), [boot, client]);
  const names = boot.clients.map((c) => c.name);

  return (
    <Page eyebrow={`${boot.sessions.length} sessions logged`} title="Activity">
      <Chips
        options={[{ value: "__all", label: "Everyone" }, ...names.map((n) => ({ value: n, label: n }))]}
        value={client}
        onChange={(v) => {
          setClient(v);
          setLimit(PAGE);
        }}
      />

      <div className="mt-5 space-y-6">
        {days.length === 0 && <Empty title="Nothing here yet" />}
        {days.slice(0, limit).map((d) => (
          <section key={d.date}>
            <h2 className="mb-2 px-1 text-[13px] font-semibold tracking-[0.08em] text-fg-3 uppercase">
              {dayLabel(d.date)}
            </h2>
            <Card>
              <ul className="divide-y divide-line">
                {d.items.map((it) =>
                  it.kind === "session" ? (
                    <li key={it.session.id}>
                      <button onClick={() => setSession(it.session)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-2">
                          <NotebookPen size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15.5px] font-semibold">{it.session.client}</div>
                          <div className="truncate text-[13.5px] text-fg-2">
                            {[it.session.focus || "Session", it.session.notes].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <PendingDot show={it.session.pending} />
                      </button>
                    </li>
                  ) : (
                    <li key={it.key}>
                      <button
                        onClick={() => setOpen((o) => ({ ...o, [it.key]: !o[it.key] }))}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2"
                        aria-expanded={!!open[it.key]}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-ink">
                          <Dumbbell size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15.5px] font-semibold">{it.client}</div>
                          <div className="truncate text-[13.5px] text-fg-2">
                            {it.workout || "Weights"} · {it.entries.length} exercise{it.entries.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        <PendingDot show={it.entries.some((e) => e.pending)} />
                        <span className="text-[13px] font-semibold text-fg-3">{open[it.key] ? "Hide" : "Show"}</span>
                      </button>
                      {open[it.key] && (
                        <ul className="mx-4 mb-3 overflow-hidden rounded-2xl bg-surface-2">
                          {it.session && (
                            <li className="border-b border-line">
                              <button onClick={() => setSession(it.session!)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-3">
                                <span className="min-w-0 flex-1 truncate text-[14.5px] text-fg-2">{it.session.notes || "Session"}</span>
                                <span className="shrink-0 text-[13px] font-semibold text-accent">Edit session</span>
                              </button>
                            </li>
                          )}
                          {it.entries.map((e) => (
                            <li key={e.id}>
                              <button onClick={() => setEntry(e)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left active:bg-surface-3">
                                <span className="min-w-0 flex-1 truncate text-[14.5px]">{e.exercise}</span>
                                <span className="tabular shrink-0 text-[14.5px] font-semibold">{e.weight_kg !== null ? kg(e.weight_kg) : e.load_text || "—"}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </Card>
          </section>
        ))}
        {days.length > limit && (
          <Button variant="secondary" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
            Show earlier days
          </Button>
        )}
      </div>

      {session && <SessionSheet key={session.id} open onClose={() => setSession(null)} session={session} clients={names} />}
      {entry && <StrengthSheet key={entry.id} open onClose={() => setEntry(null)} entry={entry} />}
    </Page>
  );
}
