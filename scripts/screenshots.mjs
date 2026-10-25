// Phone-size screenshots of the main screens (light + dark) against the local dev stack.
//   node scripts/screenshots.mjs [outDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const OUT = process.argv[2] ?? "/tmp/pt-shots";
const browser = await chromium.launch();

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
  };
  await page.goto(BASE + "/");
  await page.waitForSelector("h1");
  await shot("1-today");
  await page.goto(BASE + "/clients");
  await page.waitForSelector("h1");
  await shot("2-clients");
  await page.locator("main button").filter({ hasText: "Alex" }).first().click();
  await page.waitForSelector("text=Log workout");
  await shot("3-client");
  await page.getByRole("radio", { name: "Progress" }).click();
  await shot("4-progress");
  await page.getByRole("radio", { name: "Weights" }).click();
  await shot("5-weights");
  await page.getByRole("button", { name: "Log workout" }).click();
  await page.waitForSelector("text=New workout");
  await shot("6-log");
  await page.goto(BASE + "/activity");
  await page.waitForSelector("h1");
  await shot("7-activity");
  await page.goto(BASE + "/settings");
  await page.waitForSelector("h1");
  await shot("8-settings");
  await page.goto(BASE + "/clients");
  await page.getByRole("button", { name: "Add client" }).click();
  await shot("9-new-client");
  await ctx.close();
}
await browser.close();
console.log("saved to", OUT);
