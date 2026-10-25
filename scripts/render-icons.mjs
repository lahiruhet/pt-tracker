// Rasterise web/public/icon*.svg into the PNG sizes the web manifest and Android need.
import { createRequire } from "node:module";
// Uses the globally installed Playwright (dev tooling only, not a project dependency).
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync, mkdirSync, existsSync } from "node:fs";

const out = (p) => new URL(`../${p}`, import.meta.url).pathname;
const svg = readFileSync(out("web/public/icon.svg"), "utf8");
const maskable = readFileSync(out("web/public/icon-maskable.svg"), "utf8");
const foreground = readFileSync(out("web/public/icon-foreground.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(markup, size, file, transparent = true) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out(file), omitBackground: transparent });
}

await render(svg, 192, "web/public/icon-192.png");
await render(svg, 512, "web/public/icon-512.png");
await render(maskable, 512, "web/public/icon-maskable-512.png", false);

// Android launcher icons (legacy + round), if the android project exists.
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
if (existsSync(out("android/app/src/main/res"))) {
  for (const [d, px] of Object.entries(dens)) {
    const dir = `android/app/src/main/res/mipmap-${d}`;
    mkdirSync(out(dir), { recursive: true });
    await render(svg, px, `${dir}/ic_launcher.png`);
    await render(svg.replace('rx="112"', 'rx="256"'), px, `${dir}/ic_launcher_round.png`);
    // Adaptive icon foreground is 108dp (vs 48dp legacy icon).
    await render(foreground, Math.round(px * 2.25), `${dir}/ic_launcher_foreground.png`);
  }
}
await browser.close();
console.log("icons rendered");
