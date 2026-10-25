import { useEffect, useState } from "react";
import { syncStatusBar } from "./native";

export type ThemePref = "system" | "light" | "dark";

function read(): ThemePref {
  try {
    const t = localStorage.getItem("pt-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  syncStatusBar(dark);
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    apply(pref);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => pref === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  return [
    pref,
    (p) => {
      try {
        if (p === "system") localStorage.removeItem("pt-theme");
        else localStorage.setItem("pt-theme", p);
      } catch {}
      setPref(p);
    },
  ];
}

/** Apply the saved theme (and native status bar colours) at startup. */
export function initTheme(): void {
  apply(read());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => read() === "system" && apply("system"));
}
