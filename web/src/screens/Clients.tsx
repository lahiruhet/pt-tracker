import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useLocation } from "wouter";
import type { Bootstrap } from "../../../shared/schema";
import { ClientSheet } from "../components/Forms";
import { afterSheetsClose } from "../components/Sheet";
import { Avatar, Card, Empty, IconButton, Page, PendingDot, Pill } from "../components/ui";
import { deriveClients } from "../lib/derive";
import { money, relDay } from "../lib/format";

export function Clients({ boot }: { boot: Bootstrap }) {
  const [, go] = useLocation();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const clients = useMemo(() => deriveClients(boot), [boot]);
  const shown = clients.filter((c) => !q || `${c.name} ${c.package ?? ""} ${c.notes ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Page
      eyebrow={`${clients.length} clients`}
      title="Clients"
      action={
        <IconButton label="Add client" primary onClick={() => setAdding(true)}>
          <Plus size={24} strokeWidth={2.4} />
        </IconButton>
      }
    >
      <div className="relative mb-4">
        <Search size={19} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients"
          className="h-12 w-full rounded-full border border-line bg-surface pr-4 pl-11 text-[16px] outline-none placeholder:text-fg-3 focus:border-accent"
        />
      </div>

      {shown.length === 0 ? (
        <Empty title={q ? "No matches" : "No clients yet"}>{q ? "Try another name." : "Add your first client with the + button."}</Empty>
      ) : (
        <div className="space-y-2.5">
          {shown.map((c, i) => (
            <Card key={c.id} onClick={() => go(`/clients/${c.id}`)} className="anim-rise px-4 py-4" >
              <div className="flex items-center gap-3.5" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
                <Avatar name={c.name} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-serif text-[21px] leading-tight font-medium">{c.name}</span>
                    <PendingDot show={c.pending} />
                  </div>
                  <div className="mt-0.5 truncate text-[14px] text-fg-2">
                    {[c.package, money(c.price)].filter(Boolean).join(" · ") || "No package yet"}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {c.payment_status && <Pill tone={c.tone}>{c.payment_status}</Pill>}
                    <span className="text-[13px] text-fg-3">
                      {c.lastSession ? `Last session ${relDay(c.lastSession).toLowerCase()}` : "No sessions yet"}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <ClientSheet
          open
          onClose={() => setAdding(false)}
          client={null}
          existingNames={clients.map((c) => c.name)}
          onSaved={(id) => afterSheetsClose(() => go(`/clients/${id}`))}
        />
      )}
    </Page>
  );
}
