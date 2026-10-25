import { useMemo, useState } from "react";
import { ArrowRight, Dumbbell } from "lucide-react";
import { useLocation } from "wouter";
import type { Bootstrap } from "../../../shared/schema";
import { SessionSheet } from "../components/Forms";
import { Avatar, Button, Card, Empty, PendingDot, Pill, Section, Stat } from "../components/ui";
import { deriveClients, needsAttention } from "../lib/derive";
import { addDaysIso, greeting, longDate, relDay, startOfWeekIso, todayIso } from "../lib/format";

export function Today({ boot }: { boot: Bootstrap }) {
  const [, go] = useLocation();
  const [logSession, setLogSession] = useState(false);
  const clients = useMemo(() => deriveClients(boot), [boot]);
  const today = todayIso();
  const week = startOfWeekIso();
  const thisWeek = boot.sessions.filter((s) => (s.date ?? "") >= week && (s.date ?? "") <= today);
  const todays = boot.sessions.filter((s) => s.date === today);
  const unpaid = clients.filter((c) => c.tone === "bad");
  const active = clients.filter((c) => c.lastSession && c.lastSession >= addDaysIso(today, -14));
  const attention = needsAttention(clients);
  const recentClients = [...clients].filter((c) => c.lastSession).sort((a, b) => (b.lastSession ?? "").localeCompare(a.lastSession ?? "")).slice(0, 8);
  const name = boot.me_name;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-32" style={{ paddingTop: "calc(var(--safe-top) + 20px)" }}>
      <div className="text-[12px] font-semibold tracking-[0.12em] text-fg-3 uppercase">{longDate(today)}</div>
      <h1 className="mt-1.5 font-serif text-[40px] leading-[1.02] font-medium tracking-[-0.025em]">
        {greeting()}
        {name ? (
          <>
            ,<br />
            <span className="text-accent">{name}</span>
          </>
        ) : (
          "."
        )}
      </h1>

      <div className="mt-6 grid grid-cols-3 gap-2.5">
        <Stat label="This week" value={thisWeek.length} sub="sessions" />
        <Stat label="Active" value={active.length} sub={`of ${clients.length} clients`} />
        <Stat label="Unpaid" value={unpaid.length} sub={unpaid.length === 1 ? "client" : "clients"} />
      </div>

      <Card className="mt-4 overflow-hidden" onClick={() => go("/log")}>
        <div className="flex items-center gap-4 bg-accent px-5 py-5 text-accent-ink">
          <Dumbbell size={30} strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="font-serif text-[23px] leading-tight font-medium">Log a workout</div>
            <div className="text-[14px] opacity-85">Last weights filled in for you</div>
          </div>
          <ArrowRight size={22} />
        </div>
      </Card>

      {recentClients.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {recentClients.map((c) => (
            <button
              key={c.id}
              onClick={() => go(`/log?client=${c.id}`)}
              className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface pr-4 pl-1.5 text-[14.5px] font-semibold active:bg-surface-2"
            >
              <Avatar name={c.name} size={32} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <Section title="Needs attention">
          <Card>
            <ul className="divide-y divide-line">
              {attention.map(({ client, reason, tone }) => (
                <li key={client.id + reason}>
                  <button onClick={() => go(`/clients/${client.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-surface-2">
                    <Avatar name={client.name} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-semibold">{client.name}</div>
                      <div className="mt-0.5">
                        <Pill tone={tone}>{reason}</Pill>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <Section
        title="Today"
        action={
          <button onClick={() => setLogSession(true)} className="text-[14px] font-semibold text-accent">
            + Session
          </button>
        }
      >
        {todays.length ? (
          <Card>
            <ul className="divide-y divide-line">
              {todays.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Avatar name={s.client ?? "?"} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold">{s.client}</div>
                    <div className="truncate text-[14px] text-fg-2">{s.focus || "Session"}</div>
                  </div>
                  <PendingDot show={s.pending} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Empty title="Nothing logged yet">Sessions you log today show up here.</Empty>
        )}
      </Section>

      <Section title="Recent">
        <Card>
          <ul className="divide-y divide-line">
            {boot.sessions
              .filter((s) => s.date !== today)
              .slice(0, 6)
              .map((s) => {
                const c = clients.find((x) => x.name === s.client);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => c && go(`/clients/${c.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15.5px] font-semibold">{s.client}</div>
                        <div className="truncate text-[13.5px] text-fg-2">{s.focus || "Session"}</div>
                      </div>
                      <div className="shrink-0 text-[13.5px] text-fg-3">{relDay(s.date)}</div>
                    </button>
                  </li>
                );
              })}
          </ul>
        </Card>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => go("/activity")}>
          See all activity
        </Button>
      </Section>

      {logSession && (
        <SessionSheet open onClose={() => setLogSession(false)} session={null} clients={clients.map((c) => c.name)} />
      )}
    </div>
  );
}

