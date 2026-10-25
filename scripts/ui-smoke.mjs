// Click through the main flows in a phone-sized browser and check the changes reach the (mock) sheet.
//   needs: scripts/dev-stack.sh + `npx vite` running
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const SHEET = process.env.SHEET ?? "http://127.0.0.1:8788";
const OUT = process.argv[2];
const state = async () => (await fetch(SHEET + "/__state")).json();
const rowsOf = (snap) => snap.rows.map((r) => Object.fromEntries(snap.headers.map((h, i) => [h, r.values[i]])));
async function until(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out: " + label);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(BASE + "/");
await page.waitForSelector("h1");

// 1. Log a workout for Omar from the Today chips
await page.getByRole("button", { name: "Omar" }).first().click();
await page.waitForSelector("text=New workout");
const saveBtn = page.getByRole("button", { name: /Save \d+ exercises?/ });
const label = await saveBtn.textContent();
const n = Number(label.match(/\d+/)[0]);
await page.getByRole("button", { name: "More" }).first().click(); // +2.5 on the first exercise
await saveBtn.click();
await page.waitForSelector("text=Share to WhatsApp");
if (OUT) await page.screenshot({ path: `${OUT}/flow-saved.png` });
const msg = await page.locator("pre").textContent();
assert.ok(msg.split("\n").length === n, "share message has one line per exercise");
await page.getByRole("button", { name: "Done" }).click();
await page.waitForURL(/\/clients\//);
await until(async () => rowsOf((await state())["Strength Log"]).filter((r) => r.Client === "Omar" && r.Date === new Date().toISOString().slice(0, 10)).length >= n, "workout in sheet");
console.log("✓ log workout →", n, "rows in sheet");

// 2. Back button closes a sheet, not the screen
await page.getByRole("button", { name: "Edit client" }).click();
await page.waitForSelector("text=Edit client");
await page.goBack();
await page.waitForTimeout(300);
assert.equal(await page.locator("text=Save changes").count(), 0, "sheet closed");
assert.match(page.url(), /\/clients\//, "still on the client screen");
console.log("✓ back closes sheet");

// 3. Add a client, then edit and delete
await page.goto(BASE + "/clients");
await page.getByRole("button", { name: "Add client" }).click();
await page.getByPlaceholder("Client name").fill("Test Person");
await page.getByPlaceholder("1200").fill("900");
await page.getByRole("button", { name: "Add client" }).last().click();
await page.waitForURL(/\/clients\/[a-z0-9]+$/);
await page.waitForSelector("h1:has-text('Test Person')");
await until(async () => rowsOf((await state()).Clients).some((r) => r.Client === "Test Person" && r["Price (AED/month)"] === 900), "client in sheet");
console.log("✓ add client → sheet");

await page.getByRole("button", { name: "Edit client" }).click();
await page.getByPlaceholder("Mon, Wed, Fri 9am").fill("Tue/Thu 7pm");
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForSelector("text=Tue/Thu 7pm");
await until(async () => rowsOf((await state()).Clients).some((r) => r.Client === "Test Person" && r["Schedule / next session"] === "Tue/Thu 7pm"), "edit in sheet");
console.log("✓ edit client → sheet");

await page.getByRole("button", { name: "Edit client" }).click();
await page.getByRole("button", { name: "Delete client" }).click();
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.waitForURL(/\/clients$/);
await until(async () => !rowsOf((await state()).Clients).some((r) => r.Client === "Test Person"), "deleted in sheet");
console.log("✓ delete client → sheet");

// 4. A sheet edit shows up in the app without reloading
await page.waitForTimeout(3000); // let earlier refetches settle so this measures the polling
const fresh = "Sheet " + Date.now().toString(36).slice(-5);
await fetch(SHEET + "/__edit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tab: "Clients", values: { Client: fresh, Package: "Monthly", "Payment status": "Not paid" } }),
});
const t0 = Date.now();
await page.getByText(fresh).first().waitFor({ timeout: 15000 });
console.log(`✓ sheet edit appears in app (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

if (OUT) {
  await page.screenshot({ path: `${OUT}/flow-clients-after.png` });
}
assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log("UI smoke passed");
