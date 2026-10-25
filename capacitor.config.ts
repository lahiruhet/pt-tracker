import type { CapacitorConfig } from "@capacitor/cli";

// The Android app is a native shell around the live site: UI updates ship by deploying the
// Worker, no new APK needed. Native plugins (haptics, share sheet, system bars, back button)
// are available to the page through the Capacitor bridge.
const config: CapacitorConfig = {
  appId: "com.stackmoth.pttracker",
  appName: "PT Tracker",
  webDir: "web/dist",
  server: {
    url: "https://pt-tracker.stackmoth.com",
    // Cloudflare Access sign-in happens inside the app, not in an external browser.
    allowNavigation: ["pt-tracker.stackmoth.com", "*.cloudflareaccess.com"],
    // Shown if the site can't be reached when the app starts (no signal).
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#FAF9F5",
      showSpinner: false,
    },
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DEFAULT",
    },
  },
};

export default config;
