import { useMemo, useState, type ReactNode } from "react";
import { Dumbbell, NotebookPen, Pencil, Share2 } from "lucide-react";
import { useLocation } from "wouter";
import type { Bootstrap, Session, StrengthEntry } from "../../../shared/schema";
import { ClientSheet, SessionSheet, StrengthSheet } from "../components/Forms";
import { afterSheetsClose } from "../components/Sheet";
import { Sparkline } from "../components/Sparkline";
import { Button, Card, Empty, IconButton, Page, PendingDot, Pill, Section, Segmented, Stat } from "../components/ui";
import { deriveClients, progressFor } from "../lib/derive";
import { kg, money, relDay, shortDate, signedKg, weekday } from "../lib/format";
import { shareText } from "../lib/native";
import { shareName } from "../lib/templates";

type Tab = "sessions" | "weights" | "progress";

export function ClientDetail({ boot, id }: { boot: Bootstrap; id: string }) {
  const [, go] = useLocation();
  const [tab, setTab] = useState<Tab>("sessions");
  const [editing, setEditing] = useState(false);
  const [logSession, setLogSession] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [entry, setEntry] = useState<StrengthEntry | null>(null);
  const clients = useMemo(() => deriveClients(boot), [boot]);
  const c = clients.find((x) => x.id === id);

  if (!c) {
    return (
      <Page title="Not found" onBack={() => go("/clients")}>
        <Empty title="This client isn't here">They may have been deleted in the sheet.</Empty>
      </Page>
    );
  }

  const groups = groupWorkouts(c.strength);
  const progress = progressFor(c.strength);

  return (
    <Page
      onBack={() => history.length > 1 ? history.back() : go("/clients")}
      eyebrow={c.package || "Client"}
      title={
        <span className="flex items-center gap-3">
          {c.name}
          <PendingDot show={c.pending} />
        </span>
      }
      action={
        <IconButton label="Edit client" onClick={() => setEditing(true)}>
          <Pencil size={21} />
        </IconButton>
      }
    >
      <div className="-mt-2 mb-5 flex flex-wrap gap-2">
        {c.payment_status && <Pill tone={c.tone}>{c.payment_status}</Pill>}
        {c.price && <Pill>{money(c.price)}</Pill>}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Sessions" value={c.sessionCount} sub="all time" />
        <Stat label="This month" value={c.monthCount} sub={`${c.weekCount} this week`} />
        <Stat
          label="Last session"
          value={<span className="text-[22px]">{c.lastSession ? shortDate(c.lastSession) : "—"}</span>}
          sub={c.lastSession ? relDay(c.lastSession) : "none yet"}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button size="lg" icon={<Dumbbell size={20} />} onClick={() => go(`/log?client=${c.id}`)}>
          Log workout
        </Button>
        <Button size="lg" variant="secondary" icon={<NotebookPen size={20} />} onClick={() => setLogSession(true)}>
          Log session
        </Button>
      </div>

      <Card className="mt-4">
        <dl className="divide-y divide-line">
          <Info label="Schedule">{c.schedule}</Info>
          <Info label="Goal">{c.goal}</Info>
          <Info label="Last payment">{c.last_payment ? shortDate(c.last_payment) : null}</Info>
          <Info label="Started">{c.start_date ? shortDate(c.start_date) : null}</Info>
          <Info label="Notes">{c.notes}</Info>
        </dl>
      </Card>

      <Segmented
        className="mt-7"
        value={tab}
        onChange={setTab}
        options={[
          { value: "sessions", label: `Sessions` },
          { value: "weights", label: `Weights` },
          { value: "progress", label: `Progress` },
        ]}
      />

      {tab === "sessions" && (
        <Section>
          {c.sessions.length ? (
            <Card>
              <ul className="divide-y divide-line">
                {c.sessions.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setSession(s)} className="flex w-full items-start gap-4 px-4 py-3.5 text-left active:bg-surface-2">
                      <DateBadge iso={s.date} />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-center gap-2 text-[16px] font-semibold">
                          <span className="truncate">{s.focus || "Session"}</span>
                          <PendingDot show={s.pending} />
                        </div>
                        {s.notes && <div className="mt-0.5 line-clamp-2 text-[14px] text-fg-2">{s.notes}</div>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Empty title="No sessions yet" />
          )}
        </Section>
      )}

      {tab === "weights" && (
        <Section>
          {groups.length ? (
            <div className="space-y-3">
              {groups.map((g) => (
                <Card key={g.key}>
                  <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
                    <div>
                      <div className="text-[16px] font-semibold">{g.workout || "Workout"}</div>
                      <div className="text-[13px] text-fg-3">
                        {weekday(g.date)} {shortDate(g.date)}
                      </div>
                    </div>
                    <IconButton label="Share weights" onClick={() => shareText(weightsMessage(g.entries))}>
                      <Share2 size={19} />
                    </IconButton>
                  </div>
                  <ul className="divide-y divide-line">
                    {g.entries.map((e) => (
                      <li key={e.id}>
                        <button onClick={() => setEntry(e)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2">
                          <span className="min-w-0 flex-1 truncate text-[15px]">{e.exercise}</span>
                          <PendingDot show={e.pending} />
                          {e.sets_reps && <span className="shrink-0 text-[13px] text-fg-3">{e.sets_reps}</span>}
                          <span className="tabular w-24 shrink-0 text-right text-[15px] font-semibold">{e.weight_kg !== null ? kg(e.weight_kg) : e.load_text || "—"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ) : (
            <Empty title="No weights logged">Use Log workout to record them.</Empty>
          )}
        </Section>
      )}

      {tab === "progress" && (
        <Section>
          {progress.length ? (
            <div className="space-y-2.5">
              {progress.map((p) => (
                <Card key={p.exercise} className="px-4 pt-3.5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-semibold">{p.exercise}</div>
                      <div className="mt-0.5 text-[13px] text-fg-3">
                        {p.points.length === 1 ? `Once, ${shortDate(p.first.date)}` : `${p.points.length} times since ${shortDate(p.first.date)}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular text-[22px] leading-none font-semibold">{kg(p.latest.kg)}</div>
                      {p.points.length > 1 && (
                        <Pill tone={p.change > 0 ? "ok" : p.change < 0 ? "warn" : "neutral"} className="mt-1.5">
                          {signedKg(p.change)} kg
                        </Pill>
                      )}
                    </div>
                  </div>
                  {p.points.length > 1 && (
                    <div className="mt-3">
                      <Sparkline points={p.points} />
                    </div>
                  )}
                </Card>
              ))}
            </div>
          ) : (
            <Empty title="No progress yet">Progress appears once weights are logged.</Empty>
          )}
        </Section>
      )}

      {editing && (
        <ClientSheet
          open
          onClose={() => setEditing(false)}
          client={c}
          existingNames={clients.map((x) => x.name)}
          logCounts={{ sessions: c.sessionCount, strength: c.strength.length }}
          onDeleted={() => afterSheetsClose(() => go("/clients", { replace: true }))}
        />
      )}
      {logSession && <SessionSheet open onClose={() => setLogSession(false)} session={null} clients={[c.name]} defaultClient={c.name} />}
      {session && <SessionSheet key={session.id} open onClose={() => setSession(null)} session={session} clients={clients.map((x) => x.name)} />}
      {entry && <StrengthSheet key={entry.id} open onClose={() => setEntry(null)} entry={entry} />}
    </Page>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-28 shrink-0 text-[14px] text-fg-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-[15px] leading-snug whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function DateBadge({ iso }: { iso: string | null }) {
  if (!iso) return <div className="w-11" />;
  const d = new Date(iso + "T00:00:00");
  return (
    <div className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-surface-2 py-1.5">
      <span className="text-[10.5px] font-semibold tracking-wide text-fg-3 uppercase">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
      <span className="tabular text-[19px] leading-none font-semibold">{d.getDate()}</span>
    </div>
  );
}

export function groupWorkouts(entries: StrengthEntry[]) {
  const map = new Map<string, { key: string; date: string; workout: string | null; entries: StrengthEntry[] }>();
  for (const e of entries) {
    if (!e.date) continue;
    const key = `${e.date}|${e.workout ?? ""}`;
    (map.get(key) ?? map.set(key, { key, date: e.date, workout: e.workout, entries: [] }).get(key)!).entries.push(e);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** The WhatsApp message the trainer sends after a session: one exercise and load per line. */
export function weightsMessage(entries: Pick<StrengthEntry, "exercise" | "weight_kg" | "load_text">[]): string {
  return entries
    .filter((e) => e.exercise)
    .map((e) => `${shareName(e.exercise!)} ${e.load_text || (e.weight_kg !== null ? kg(e.weight_kg) : "")}`.trim())
    .join("\n");
}
