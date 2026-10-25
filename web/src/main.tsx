import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "./styles.css";
import { App } from "./App";
import { initNative } from "./lib/native";
import { BOOT, persister, queryClient } from "./lib/store";
import { initTheme } from "./lib/theme";

initTheme();
initNative();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 7 * 24 * 3600_000,
        buster: "1",
        dehydrateOptions: {
          // Keep unsent changes across restarts so they go out once there's signal.
          shouldDehydrateMutation: (m) => m.state.isPaused,
          shouldDehydrateQuery: (q) => q.state.status === "success",
        },
      }}
      onSuccess={() => queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries({ queryKey: BOOT }))}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
