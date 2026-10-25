import { useEffect, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { CloudOff, LogIn } from "lucide-react";
import { Route, Switch } from "wouter";
import { BottomNav, Toasts } from "./components/Chrome";
import { Button, Spinner } from "./components/ui";
import { AuthError } from "./lib/api";
import { useBoot } from "./lib/store";
import { ActivityScreen } from "./screens/Activity";
import { ClientDetail } from "./screens/ClientDetail";
import { Clients } from "./screens/Clients";
import { LogWorkout } from "./screens/LogWorkout";
import { SettingsScreen } from "./screens/Settings";
import { Today } from "./screens/Today";

function signIn() {
  // A full page load goes through Cloudflare Access, which shows its sign-in page.
  location.href = "/?signin=" + Date.now();
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function StatusBar({ signedOut }: { signedOut: boolean }) {
  const online = useOnline();
  const paused = useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length;
  if (signedOut) {
    return (
      <button
        onClick={signIn}
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-fg py-2 text-[13.5px] font-semibold text-bg"
        style={{ paddingTop: "calc(var(--safe-top) + 8px)" }}
      >
        <LogIn size={16} /> Signed out. Tap to sign in again
      </button>
    );
  }
  if (online && !paused) return null;
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warn-soft py-2 text-[13.5px] font-semibold text-warn"
      style={{ paddingTop: "calc(var(--safe-top) + 8px)" }}
    >
      <CloudOff size={16} />
      {online ? `Sending ${paused} change${paused === 1 ? "" : "s"}…` : paused ? `Offline: ${paused} change${paused === 1 ? "" : "s"} will sync later` : "Offline: showing saved data"}
    </div>
  );
}

function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <img src="/icon.svg" alt="" className="size-20 rounded-[24px] shadow-card" />
      <div className="mt-6 font-serif text-[30px] font-medium tracking-[-0.02em]">PT Tracker</div>
      <div className="mt-3 text-fg-2">{children ?? <Spinner className="text-accent" />}</div>
    </div>
  );
}

export function App() {
  const boot = useBoot();
  const data = boot.data;

  if (!data) {
    if (boot.error instanceof AuthError) {
      return (
        <Splash>
          <p className="mb-5 text-[16px]">Sign in to continue.</p>
          <Button size="lg" icon={<LogIn size={19} />} onClick={signIn}>
            Sign in
          </Button>
        </Splash>
      );
    }
    if (boot.error) {
      return (
        <Splash>
          <p className="mb-5 text-[16px]">Couldn’t load: {boot.error.message}</p>
          <Button size="lg" onClick={() => boot.refetch()}>
            Try again
          </Button>
        </Splash>
      );
    }
    return <Splash />;
  }

  return (
    <>
      <StatusBar signedOut={boot.error instanceof AuthError} />
      <main>
        <Switch>
          <Route path="/">{() => <Today boot={data} />}</Route>
          <Route path="/clients">{() => <Clients boot={data} />}</Route>
          <Route path="/clients/:id">{(p) => <ClientDetail key={p.id} boot={data} id={p.id} />}</Route>
          <Route path="/log">{() => <LogWorkout boot={data} />}</Route>
          <Route path="/activity">{() => <ActivityScreen boot={data} />}</Route>
          <Route path="/settings">{() => <SettingsScreen boot={data} />}</Route>
          <Route>{() => <Today boot={data} />}</Route>
        </Switch>
      </main>
      <BottomNav />
      <Toasts />
    </>
  );
}
