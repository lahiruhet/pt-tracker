import { App } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";

/** True inside the Android app shell; false in a normal browser. */
export const isNative = Capacitor.isNativePlatform();

export function tap(): void {
  if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  else navigator.vibrate?.(6);
}

export function success(): void {
  if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else navigator.vibrate?.([8, 40, 8]);
}

/** Share text through the system sheet (WhatsApp is usually first), falling back to a wa.me link. */
export async function shareText(text: string): Promise<void> {
  try {
    if (isNative) {
      await Share.share({ text, dialogTitle: "Send to client" });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch {
    return; // cancelled
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

export function syncStatusBar(dark: boolean): void {
  if (!isNative) return;
  // Dark theme → light icons on the bars, and the other way round.
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

export function initNative(): void {
  if (!isNative) return;
  document.documentElement.classList.add("native");
  // Back closes the open sheet / goes back a screen; on the home screen it leaves the app.
  App.addListener("backButton", () => {
    if (location.pathname === "/" && !history.state?.sheet) App.minimizeApp();
    else history.back();
  });
  requestAnimationFrame(() => SplashScreen.hide().catch(() => {}));
}
