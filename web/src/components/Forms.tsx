import { useMemo, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { Client, Session, StrengthEntry } from "../../../shared/schema";
import { newId } from "../lib/api";
import { kg, todayIso } from "../lib/format";
import { success } from "../lib/native";
import { useCreate, useDelete, useUpdate } from "../lib/store";
import { toast } from "../lib/toast";
import { Sheet } from "./Sheet";
import { Button, Chips, Field, Input, Stepper, TextArea } from "./ui";

type Draft<T> = { [K in keyof T]: T[K] extends number | null ? number | null : string };

function changed<T extends Record<string, unknown>>(before: T | null, after: T): Partial<T> {
  if (!before) return after;
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) if ((before[k] ?? "") !== (after[k] ?? "")) out[k] = after[k];
  return out;
}

const nullIfEmpty = (s: string) => (s.trim() === "" ? null : s.trim());

// --- Confirm -------------------------------------------------------------------------------

export function Confirm({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  extra?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-[16px] leading-relaxed text-fg-2">{children}</div>
      {extra}
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="danger" size="lg" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

// --- Client --------------------------------------------------------------------------------

const PAYMENT_QUICK = ["Paid", "Not paid", "Not discussed"] as const;

type ClientDraft = Draft<Pick<Client, "name" | "start_date" | "goal" | "package" | "price" | "last_payment" | "payment_status" | "schedule" | "notes">>;

export function ClientSheet({
  open,
  onClose,
  client,
  existingNames,
  logCounts,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  client: Client | null;
  existingNames: string[];
  logCounts?: { sessions: number; strength: number };
  onSaved?: (id: string, name: string) => void;
  onDeleted?: () => void;
}) {
  const initial: ClientDraft = {
    name: client?.name ?? "",
    start_date: client?.start_date ?? todayIso(),
    goal: client?.goal ?? "",
    package: client?.package ?? "",
    price: client?.price ?? "",
    last_payment: client?.last_payment ?? "",
    payment_status: client?.payment_status ?? (client ? "" : "Not discussed"),
    schedule: client?.schedule ?? "",
    notes: client?.notes ?? "",
  };
  const [d, setD] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [cascade, setCascade] = useState(true);
  const create = useCreate();
  const update = useUpdate();
  const del = useDelete();
  const set = (k: keyof ClientDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  const nameTaken = useMemo(
    () => existingNames.some((n) => n.toLowerCase() === d.name.trim().toLowerCase() && n !== client?.name),
    [existingNames, d.name, client],
  );

  const save = () => {
    const row = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, nullIfEmpty(v as string)])) as Record<string, string | null>;
    if (!row.name) return toast("Add a name", { tone: "error" });
    if (nameTaken) return toast(`${row.name} already exists`, { tone: "error" });
    if (client) {
      const patch = changed(client as unknown as Record<string, unknown>, row);
      if (Object.keys(patch).length) update.mutate({ tab: "clients", id: client.id, patch });
      success();
      onClose();
      onSaved?.(client.id, row.name);
    } else {
      const id = newId();
      create.mutate({ tab: "clients", row: { id, ...row } });
      success();
      toast(`${row.name} added`);
      onClose();
      onSaved?.(id, row.name);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={client ? "Edit client" : "New client"}
        footer={
          <Button size="lg" className="w-full" onClick={save}>
            {client ? "Save changes" : "Add client"}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Name" hint={nameTaken ? "Another client already has this name." : client ? "Renaming also updates their sessions and weights." : undefined}>
            <Input value={d.name} onChange={set("name")} placeholder="Client name" autoCapitalize="words" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" value={d.start_date} onChange={set("start_date")} />
            </Field>
            <Field label="Price (AED/month)">
              <Input value={d.price} onChange={set("price")} inputMode="text" placeholder="1200" />
            </Field>
          </div>
          <Field label="Package">
            <Input value={d.package} onChange={set("package")} placeholder="3 sessions a week, monthly" />
          </Field>
          <Field label="Goal">
            <Input value={d.goal} onChange={set("goal")} placeholder="Fat loss, strength…" />
          </Field>
          <Field label="Payment status">
            <Input value={d.payment_status} onChange={set("payment_status")} placeholder="Paid / Not paid" />
          </Field>
          <Chips
            options={PAYMENT_QUICK.map((v) => ({ value: v, label: v }))}
            value={(PAYMENT_QUICK as readonly string[]).includes(d.payment_status) ? (d.payment_status as (typeof PAYMENT_QUICK)[number]) : null}
            onChange={(v) => setD({ ...d, payment_status: v, last_payment: v === "Paid" && !d.last_payment ? todayIso() : d.last_payment })}
          />
          <Field label="Last payment">
            <div className="flex gap-2">
              <Input type="date" value={d.last_payment} onChange={set("last_payment")} />
              <Button variant="secondary" className="shrink-0" onClick={() => setD({ ...d, last_payment: todayIso() })}>
                Today
              </Button>
            </div>
          </Field>
          <Field label="Schedule / next session">
            <Input value={d.schedule} onChange={set("schedule")} placeholder="Mon, Wed, Fri 9am" />
          </Field>
          <Field label="Notes">
            <TextArea value={d.notes} onChange={set("notes")} placeholder="Anything worth remembering" rows={4} />
          </Field>
          {client && (
            <Button variant="danger" className="w-full" icon={<Trash2 size={18} />} onClick={() => setConfirm(true)}>
              Delete client
            </Button>
          )}
        </div>
      </Sheet>
      {client && (
        <Confirm
          open={confirm}
          onClose={() => setConfirm(false)}
          title={`Delete ${client.name}?`}
          confirmLabel="Delete"
          onConfirm={() => {
            del.mutate({ tab: "clients", id: client.id, cascade });
            setConfirm(false);
            onClose();
            toast(`${client.name} deleted`);
            onDeleted?.();
          }}
          extra={
            logCounts && logCounts.sessions + logCounts.strength > 0 ? (
              <label className="mt-4 flex items-start gap-3 rounded-2xl bg-surface-2 p-4 text-[15px]">
                <input type="checkbox" className="mt-0.5 size-5 accent-[var(--accent)]" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
                <span>
                  Also delete their {logCounts.sessions} sessions and {logCounts.strength} weight entries
                </span>
              </label>
            ) : null
          }
        >
          This removes the client from the app and from the Google Sheet.
        </Confirm>
      )}
    </>
  );
}

// --- Session -------------------------------------------------------------------------------

export function SessionSheet({
  open,
  onClose,
  session,
  clients,
  defaultClient,
}: {
  open: boolean;
  onClose: () => void;
  session: Session | null;
  clients: string[];
  defaultClient?: string;
}) {
  const [d, setD] = useState({
    client: session?.client ?? defaultClient ?? "",
    date: session?.date ?? todayIso(),
    focus: session?.focus ?? "",
    notes: session?.notes ?? "",
  });
  const [confirm, setConfirm] = useState(false);
  const create = useCreate();
  const update = useUpdate();
  const del = useDelete();

  const save = () => {
    if (!d.client) return toast("Pick a client", { tone: "error" });
    if (!d.date) return toast("Pick a date", { tone: "error" });
    const row = { client: d.client, date: d.date, focus: nullIfEmpty(d.focus), notes: nullIfEmpty(d.notes) };
    if (session) {
      const patch = changed(session as unknown as Record<string, unknown>, row);
      if (Object.keys(patch).length) update.mutate({ tab: "sessions", id: session.id, patch });
    } else {
      create.mutate({ tab: "sessions", row: { id: newId(), ...row } });
      toast("Session logged");
    }
    success();
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={session ? "Edit session" : "Log session"}
        footer={
          <Button size="lg" className="w-full" onClick={save}>
            {session ? "Save changes" : "Log session"}
          </Button>
        }
      >
        <div className="space-y-4">
          {!defaultClient || session ? (
            <Field label="Client">
              <Chips options={clients.map((c) => ({ value: c, label: c }))} value={d.client || null} onChange={(v) => setD({ ...d, client: v })} />
            </Field>
          ) : null}
          <Field label="Date">
            <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          </Field>
          <Field label="Session / focus">
            <Input value={d.focus} onChange={(e) => setD({ ...d, focus: e.target.value })} placeholder="Upper 1, Legs, Cardio…" />
          </Field>
          <Chips
            options={["Upper 1", "Upper 2", "Lower", "Cardio", "Trial session"].map((v) => ({ value: v, label: v }))}
            value={d.focus || null}
            onChange={(v) => setD({ ...d, focus: v })}
          />
          <Field label="Notes">
            <TextArea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="How it went" rows={3} />
          </Field>
          {session && (
            <Button variant="danger" className="w-full" icon={<Trash2 size={18} />} onClick={() => setConfirm(true)}>
              Delete session
            </Button>
          )}
        </div>
      </Sheet>
      {session && (
        <Confirm
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Delete this session?"
          confirmLabel="Delete"
          onConfirm={() => {
            del.mutate({ tab: "sessions", id: session.id });
            setConfirm(false);
            onClose();
            toast("Session deleted");
          }}
        >
          It will also be removed from the Session Log in the sheet.
        </Confirm>
      )}
    </>
  );
}

// --- Strength entry ------------------------------------------------------------------------

export function StrengthSheet({ open, onClose, entry }: { open: boolean; onClose: () => void; entry: StrengthEntry }) {
  const [d, setD] = useState({
    exercise: entry.exercise ?? "",
    weight_kg: entry.weight_kg,
    load_text: entry.load_text ?? "",
    sets_reps: entry.sets_reps ?? "",
    workout: entry.workout ?? "",
    date: entry.date ?? todayIso(),
  });
  const [confirm, setConfirm] = useState(false);
  const update = useUpdate();
  const del = useDelete();

  const save = () => {
    if (!d.exercise.trim()) return toast("Add the exercise", { tone: "error" });
    const loadAuto = entry.load_text === kg(entry.weight_kg) || !entry.load_text;
    const row = {
      exercise: d.exercise.trim(),
      weight_kg: d.weight_kg,
      // Keep "Load as sent" in step with the weight unless it held custom text.
      load_text: loadAuto && d.load_text === (entry.load_text ?? "") && d.weight_kg !== null ? kg(d.weight_kg) : nullIfEmpty(d.load_text),
      sets_reps: nullIfEmpty(d.sets_reps),
      workout: nullIfEmpty(d.workout),
      date: d.date,
    };
    const patch = changed(entry as unknown as Record<string, unknown>, row);
    if (Object.keys(patch).length) update.mutate({ tab: "strength", id: entry.id, patch });
    success();
    onClose();
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Edit weight"
        footer={
          <Button size="lg" className="w-full" onClick={save}>
            Save changes
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="text-[14px] text-fg-3">{entry.client}</div>
          <Field label="Exercise">
            <Input value={d.exercise} onChange={(e) => setD({ ...d, exercise: e.target.value })} />
          </Field>
          <Field label="Weight">
            <Stepper value={d.weight_kg} onChange={(v) => setD({ ...d, weight_kg: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Load as sent">
              <Input value={d.load_text} onChange={(e) => setD({ ...d, load_text: e.target.value })} placeholder="3rd plate" />
            </Field>
            <Field label="Sets x reps">
              <Input value={d.sets_reps} onChange={(e) => setD({ ...d, sets_reps: e.target.value })} placeholder="3 x 10" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Workout">
              <Input value={d.workout} onChange={(e) => setD({ ...d, workout: e.target.value })} />
            </Field>
            <Field label="Date">
              <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
            </Field>
          </div>
          <Button variant="danger" className="w-full" icon={<Trash2 size={18} />} onClick={() => setConfirm(true)}>
            Delete entry
          </Button>
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this entry?"
        confirmLabel="Delete"
        onConfirm={() => {
          del.mutate({ tab: "strength", id: entry.id });
          setConfirm(false);
          onClose();
          toast("Entry deleted");
        }}
      >
        {entry.exercise} {entry.load_text ? `· ${entry.load_text}` : ""} will be removed from the Strength Log.
      </Confirm>
    </>
  );
}
