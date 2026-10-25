import { useEffect } from "react";
import { MutationCache, QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Bootstrap, Client, Session, StrengthEntry, TabName } from "../../../shared/schema";
import { api, ApiError, AuthError } from "./api";
import { toast } from "./toast";

export const BOOT = ["bootstrap"] as const;

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (err) => {
      if (!(err instanceof AuthError)) toast(`Not saved: ${err.message}`, { tone: "error" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 7 * 24 * 3600_000,
      refetchOnWindowFocus: true,
      retry: (n, err) => !(err instanceof AuthError) && n < 2,
    },
    mutations: {
      // Paused while offline, persisted, and replayed when the connection is back.
      retry: (n, err) => err instanceof ApiError && err.status === 0 && n < 3,
    },
  },
});

export const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "pt-cache-v1",
  throttleTime: 500,
});

type Row = Client | Session | StrengthEntry;
type Lists = Pick<Bootstrap, "clients" | "sessions" | "strength">;

function patchBoot(fn: (b: Bootstrap) => Bootstrap) {
  queryClient.setQueryData<Bootstrap>(BOOT, (b) => (b ? fn(b) : b));
}

function refreshWhenIdle() {
  // isMutating still counts the mutation that just settled.
  if (queryClient.isMutating() <= 1) queryClient.invalidateQueries({ queryKey: BOOT });
}

export function useBoot() {
  const boot = useQuery({
    queryKey: BOOT,
    queryFn: () => api<Bootstrap>("/api/bootstrap"),
    refetchInterval: (q) => (q.state.data?.sync.pending ? 4000 : 5 * 60_000),
  });
  // Poll the tiny revision counter while the app is open; refetch everything only when it moves.
  const rev = useQuery({
    queryKey: ["rev"],
    queryFn: () => api<{ rev: number }>("/api/rev"),
    refetchInterval: 8000,
    enabled: !!boot.data,
  });
  useEffect(() => {
    if (rev.data && boot.data && rev.data.rev !== boot.data.rev && !boot.isFetching && queryClient.isMutating() === 0) {
      queryClient.invalidateQueries({ queryKey: BOOT });
    }
  }, [rev.data, boot.data, boot.isFetching]);
  return boot;
}

// --- Mutations (registered as defaults so paused ones can resume after a reload) ---------------

export interface CreateVars {
  tab: TabName;
  row: Record<string, unknown> & { id: string };
}
export interface UpdateVars {
  tab: TabName;
  id: string;
  patch: Record<string, unknown>;
}
export interface DeleteVars {
  tab: TabName;
  id: string;
  cascade?: boolean;
}
export interface WorkoutVars {
  client: string;
  date: string;
  workout: string;
  entries: Array<{ id: string; exercise: string; weight_kg: number | null; load_text: string | null; sets_reps: string | null }>;
  session: { id: string; focus: string; notes: string | null } | null;
}

const now = () => new Date().toISOString();

queryClient.setMutationDefaults(["create"], {
  mutationFn: (v: CreateVars) => api(`/api/${v.tab}`, { method: "POST", body: v.row }),
  onMutate: (v: CreateVars) => {
    patchBoot((b) => ({ ...b, [v.tab]: [{ ...v.row, updated_at: now(), pending: true } as Row, ...(b[v.tab] as Row[])] }));
  },
  onSettled: refreshWhenIdle,
});

queryClient.setMutationDefaults(["update"], {
  mutationFn: (v: UpdateVars) => api(`/api/${v.tab}/${v.id}`, { method: "PATCH", body: v.patch }),
  onMutate: (v: UpdateVars) => {
    patchBoot((b) => {
      const list = b[v.tab] as Row[];
      const before = list.find((r) => r.id === v.id);
      const next: Lists = { clients: b.clients, sessions: b.sessions, strength: b.strength };
      (next as any)[v.tab] = list.map((r) => (r.id === v.id ? { ...r, ...v.patch, pending: true } : r));
      // A client rename also renames their log rows (the server does the same).
      if (v.tab === "clients" && before && typeof v.patch.name === "string" && v.patch.name !== (before as Client).name) {
        const from = (before as Client).name;
        const to = v.patch.name;
        next.sessions = next.sessions.map((s) => (s.client === from ? { ...s, client: to } : s));
        next.strength = next.strength.map((s) => (s.client === from ? { ...s, client: to } : s));
      }
      return { ...b, ...next };
    });
  },
  onSettled: refreshWhenIdle,
});

queryClient.setMutationDefaults(["delete"], {
  mutationFn: (v: DeleteVars) => api(`/api/${v.tab}/${v.id}${v.cascade ? "?cascade=1" : ""}`, { method: "DELETE" }),
  onMutate: (v: DeleteVars) => {
    patchBoot((b) => {
      const list = b[v.tab] as Row[];
      const gone = list.find((r) => r.id === v.id) as Client | undefined;
      const out = { ...b, [v.tab]: list.filter((r) => r.id !== v.id) };
      if (v.tab === "clients" && v.cascade && gone) {
        out.sessions = b.sessions.filter((s) => s.client !== gone.name);
        out.strength = b.strength.filter((s) => s.client !== gone.name);
      }
      return out;
    });
  },
  onSettled: refreshWhenIdle,
});

queryClient.setMutationDefaults(["workout"], {
  mutationFn: (v: WorkoutVars) => api("/api/workouts", { method: "POST", body: v }),
  onMutate: (v: WorkoutVars) => {
    const t = now();
    patchBoot((b) => ({
      ...b,
      strength: [
        ...v.entries.map((e) => ({ ...e, client: v.client, date: v.date, workout: v.workout, updated_at: t, pending: true })),
        ...b.strength,
      ],
      sessions: v.session
        ? [{ id: v.session.id, client: v.client, date: v.date, focus: v.session.focus, notes: v.session.notes, updated_at: t, pending: true }, ...b.sessions]
        : b.sessions,
    }));
  },
  onSettled: refreshWhenIdle,
});

export const useCreate = () => useMutation<unknown, Error, CreateVars>({ mutationKey: ["create"] });
export const useUpdate = () => useMutation<unknown, Error, UpdateVars>({ mutationKey: ["update"] });
export const useDelete = () => useMutation<unknown, Error, DeleteVars>({ mutationKey: ["delete"] });
export const useWorkout = () => useMutation<unknown, Error, WorkoutVars>({ mutationKey: ["workout"] });

export function useSyncNow() {
  return useMutation({
    mutationKey: ["sync"],
    mutationFn: () => api<{ error?: string }>("/api/sync", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: BOOT }),
  });
}
