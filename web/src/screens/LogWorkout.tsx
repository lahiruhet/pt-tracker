import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, Share2, X } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import type { Bootstrap } from "../../../shared/schema";
import { Sheet, afterSheetsClose } from "../components/Sheet";
import { Avatar, Button, Chips, Field, IconButton, Input, Segmented, Stepper, cx } from "../components/ui";
import { newId } from "../lib/api";
import { deriveClients, knownExercises, lastByExercise } from "../lib/derive";
import { addDaysIso, kg, shortDate, todayIso } from "../lib/format";
import { shareText, success, tap } from "../lib/native";
import { useWorkout } from "../lib/store";
import { TEMPLATES, TEMPLATE_NAMES, nextTemplate } from "../lib/templates";
import { toast } from "../lib/toast";
import { weightsMessage } from "./ClientDetail";

interface Row {
  key: string;
  exercise: string;
  weight: number | null;
  load: string; // free text, e.g. "3rd plate"; empty = use the weight
  sets: string;
  done: boolean;
  last?: { label: string; date: string };
}

export function LogWorkout({ boot }: { boot: Bootstrap }) {
  const [, go] = useLocation();
  const search = useSearch();
  const clients = useMemo(() => deriveClients(boot), [boot]);
  const preset = new URLSearchParams(search).get("client");
  const [clientId, setClientId] = useState<string | null>(clients.find((c) => c.id === preset)?.id ?? null);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const [date, setDate] = useState(todayIso());
  const [pickDate, setPickDate] = useState(false);
  const [template, setTemplate] = useState<string>(() => nextTemplate(client?.lastWorkout));
  const [rows, setRows] = useState<Row[]>([]);
  const [alsoSession, setAlsoSession] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<{ client: string; message: string; id: string } | null>(null);
  const save = useWorkout();

  const last = useMemo(() => (client ? lastByExercise(client.strength) : new Map()), [client]);

  const makeRow = (exercise: string, sets: string): Row => {
    const prev = last.get(exercise);
    const weight = prev?.weight_kg ?? null;
    const load = weight === null ? (prev?.load_text ?? "") : "";
    return {
      key: newId(),
      exercise,
      weight,
      load,
      sets: sets || prev?.sets_reps || "",
      done: !!prev,
      last: prev ? { label: prev.weight_kg !== null ? kg(prev.weight_kg) : prev.load_text || "—", date: prev.date ?? "" } : undefined,
    };
  };

  // Rebuild the list when the client or workout changes.
  useEffect(() => {
    if (!client) return;
    setRows(template === "Custom" ? [] : (TEMPLATES[template] ?? []).map((t) => makeRow(t.exercise, t.sets)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, template]);

  const pickClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    setClientId(id);
    setTemplate(nextTemplate(c?.lastWorkout));
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, done: patch.done ?? (patch.weight !== undefined || patch.load !== undefined ? true : r.done) } : r)));

  const chosen = rows.filter((r) => r.done && (r.weight !== null || r.load.trim()));

  const submit = () => {
    if (!client) return;
    if (!chosen.length && !alsoSession) return toast("Tick at least one exercise", { tone: "error" });
    const workout = template === "Custom" ? "Workout" : template;
    const entries = chosen.map((r) => ({
      id: newId(),
      exercise: r.exercise,
      weight_kg: r.load.trim() ? null : r.weight,
      load_text: r.load.trim() || kg(r.weight),
      sets_reps: r.sets.trim() || null,
    }));
    save.mutate({
      client: client.name,
      date,
      workout,
      entries,
      session: alsoSession ? { id: newId(), focus: workout, notes: entries.length ? "Weights logged in app" : null } : null,
    });
    success();
    setSaved({ client: client.name, id: client.id, message: weightsMessage(entries) });
  };

  const exit = () => (history.length > 1 ? history.back() : go("/"));

  return (
    <div className="mx-auto min-h-dvh w-full max-w-xl px-4" style={{ paddingTop: "calc(var(--safe-top) + 8px)", paddingBottom: "calc(var(--safe-bottom) + 120px)" }}>
      <header className="flex items-center justify-between pt-1">
        <IconButton label="Close" onClick={exit} className="-ml-2">
          <X size={24} />
        </IconButton>
        <span className="text-[12px] font-semibold tracking-[0.12em] text-fg-3 uppercase">New workout</span>
        <div className="size-11" />
      </header>
      <h1 className="mt-1 font-serif text-[36px] leading-tight font-medium tracking-[-0.02em]">
        {client ? client.name : "Who's training?"}
      </h1>

      {!client || !preset ? (
        <div className="mt-4">
          <Chips options={clients.map((c) => ({ value: c.id, label: c.name }))} value={clientId} onChange={pickClient} />
        </div>
      ) : null}

      {client && (
        <>
          <div className="mt-5">
            <Chips
              options={[
                { value: todayIso(), label: "Today" },
                { value: addDaysIso(todayIso(), -1), label: "Yesterday" },
                { value: "other", label: pickDate || ![todayIso(), addDaysIso(todayIso(), -1)].includes(date) ? shortDate(date) : "Other day" },
              ]}
              value={pickDate || ![todayIso(), addDaysIso(todayIso(), -1)].includes(date) ? "other" : date}
              onChange={(v) => {
                setPickDate(v === "other");
                if (v !== "other") setDate(v);
              }}
            />
          </div>
          {pickDate && (
            <div className="mt-2">
              <Input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            </div>
          )}

          <Segmented className="mt-4" value={template} onChange={setTemplate} options={TEMPLATE_NAMES.map((t) => ({ value: t, label: t }))} />

          <div className="mt-5 space-y-2.5">
            {rows.map((r) => (
              <div
                key={r.key}
                className={cx("rounded-[22px] border bg-surface px-4 pt-3 pb-4 shadow-card transition-colors", r.done ? "border-line" : "border-dashed border-line opacity-80")}
              >
                <div className="flex items-start gap-3">
                  <button
                    aria-label={r.done ? "Skip exercise" : "Include exercise"}
                    onClick={() => {
                      tap();
                      update(r.key, { done: !r.done });
                    }}
                    className={cx(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      r.done ? "border-accent bg-accent text-accent-ink" : "border-line text-transparent",
                    )}
                  >
                    <Check size={16} strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16.5px] font-semibold">{r.exercise}</div>
                    <div className="text-[13px] text-fg-3">
                      {r.last ? `Last ${r.last.label} · ${shortDate(r.last.date)}` : "First time"}
                      {r.sets && ` · ${r.sets}`}
                    </div>
                  </div>
                  <button
                    aria-label="Remove"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="-mt-1 -mr-2 flex size-9 items-center justify-center rounded-full text-fg-3 active:bg-surface-2"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
                  {r.load ? (
                    <Input value={r.load} onChange={(e) => update(r.key, { load: e.target.value })} className="h-12" />
                  ) : (
                    <Stepper value={r.weight} onChange={(v) => update(r.key, { weight: v })} />
                  )}
                  <button
                    onClick={() => update(r.key, r.load ? { load: "" } : { load: "1st plate", weight: null })}
                    className="h-12 rounded-full px-3 text-[13px] font-semibold text-fg-2 active:bg-surface-2"
                  >
                    {r.load ? "kg" : "Plate"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="secondary" className="mt-3 w-full" icon={<Plus size={19} />} onClick={() => setAdding(true)}>
            Add exercise
          </Button>

          <label className="mt-5 flex items-center gap-3 rounded-[20px] bg-surface-2 px-4 py-3.5 text-[15px]">
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={alsoSession} onChange={(e) => setAlsoSession(e.target.checked)} />
            <span className="flex-1">Also add to the Session Log</span>
          </label>
        </>
      )}

      {client && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/92 backdrop-blur-xl" style={{ paddingBottom: "var(--safe-bottom)" }}>
          <div className="mx-auto max-w-xl px-4 py-3">
            <Button size="lg" className="w-full" onClick={submit} disabled={!chosen.length && !alsoSession}>
              {chosen.length ? `Save ${chosen.length} exercise${chosen.length === 1 ? "" : "s"}` : "Save session"}
            </Button>
          </div>
        </div>
      )}

      {adding && client && (
        <AddExercise
          known={knownExercises(boot.strength)}
          exclude={rows.map((r) => r.exercise)}
          onClose={() => setAdding(false)}
          onPick={(name) => {
            setRows((rs) => [...rs, { ...makeRow(name, ""), done: true }]);
            setAdding(false);
          }}
        />
      )}

      {saved && (
        <Sheet
          open
          onClose={() => {
            setSaved(null);
            afterSheetsClose(() => go(`/clients/${saved.id}`, { replace: true }));
          }}
          title="Saved"
        >
          <p className="text-[16px] text-fg-2">
            {saved.message ? `Workout logged for ${saved.client}. Send them their weights:` : `Session logged for ${saved.client}.`}
          </p>
          {saved.message && (
            <pre className="mt-4 rounded-2xl bg-surface-2 p-4 font-sans text-[15px] leading-relaxed whitespace-pre-wrap">{saved.message}</pre>
          )}
          <div className="mt-5 flex flex-col gap-2">
            {saved.message && (
              <Button size="lg" icon={<Share2 size={19} />} onClick={() => shareText(saved.message)}>
                Share to WhatsApp
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(null);
                afterSheetsClose(() => go(`/clients/${saved.id}`, { replace: true }));
              }}
            >
              Done
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function AddExercise({ known, exclude, onPick, onClose }: { known: string[]; exclude: string[]; onPick: (n: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = known.filter((k) => !exclude.includes(k) && k.toLowerCase().includes(q.toLowerCase()));
  const exact = known.some((k) => k.toLowerCase() === q.trim().toLowerCase());
  return (
    <Sheet open onClose={onClose} title="Add exercise">
      <Field label="Search or type a new one">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-3" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="pl-11" placeholder="e.g. Leg press" />
        </div>
      </Field>
      {q.trim() && !exact && (
        <Button className="mt-3 w-full" icon={<Plus size={18} />} onClick={() => onPick(q.trim())}>
          Add “{q.trim()}”
        </Button>
      )}
      <ul className="mt-3 divide-y divide-line">
        {list.map((k) => (
          <li key={k}>
            <button onClick={() => onPick(k)} className="flex w-full items-center gap-3 py-3.5 text-left text-[16px] active:bg-surface-2">
              <Avatar name={k} size={34} />
              {k}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
