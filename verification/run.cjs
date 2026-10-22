const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const deps = argument("--deps", __dirname);
const load = createRequire(path.resolve(deps, "package.json"));
const { chromium } = load("playwright");
const { PNG } = load("pngjs");
const electronMode = process.argv.includes("--electron");
const url = argument("--url", "http://127.0.0.1:18941");
const state = argument("--state");
if (!state) throw new Error("Pass --state with an isolated test host's browser storage state");
const output = path.join(__dirname, "artifacts");
fs.mkdirSync(output, { recursive: true });
const prefix = electronMode ? "electron-" : "";
const results = { appVersion: "0.13.0-beta.1", engine: electronMode ? "electron" : "chromium", nativeDeviceTested: false, checks: [], cases: [] };
let screenshotCssWidth = 1440;

function check(name, condition, details) {
  results.checks.push({ name, passed: Boolean(condition), details });
  assert.ok(condition, `${name}: ${JSON.stringify(details)}`);
}

function wallpaper(kind) {
  const png = new PNG({ width: 1024, height: 768 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const wave = (Math.sin(x / 85 + y / 60) + 1) / 2;
      const colors = kind === "warm" ? [220, 60, 105] : kind === "cool" ? [40, 120, 235] :
        [30 + 90 * wave, 75 + 90 * (1 - y / png.height), 80 + 100 * x / png.width];
      png.data[i] = colors[0];
      png.data[i + 1] = colors[1];
      png.data[i + 2] = colors[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const warm = `data:image/png;base64,${wallpaper("warm").toString("base64")}`;
const cool = `data:image/png;base64,${wallpaper("cool").toString("base64")}`;
const fixture = wallpaper("landscape");
fs.writeFileSync(path.join(output, "diagnostic-background.png"), fixture);
const scenic = `data:image/png;base64,${fixture.toString("base64")}`;

function difference(a, b, region) {
  const first = PNG.sync.read(a);
  const second = PNG.sync.read(b);
  // Electron screenshots may retain the Retina backing scale even when CSS
  // scale is requested. Probe coordinates always describe CSS viewport pixels.
  const scale = first.width / screenshotCssWidth;
  const [left, top, width, height] = region.map((value) => Math.round(value * scale));
  let changed = 0;
  let total = 0;
  let summedDelta = 0;
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      const i = (y * first.width + x) * 4;
      let delta = 0;
      for (let k = 0; k < 3; k++) delta += Math.abs(first.data[i + k] - second.data[i + k]);
      if (delta > 15) changed++;
      summedDelta += delta;
      total++;
    }
  }
  return { changedFraction: changed / total, meanRgbDelta: summedDelta / total / 3 };
}

async function snapshot(page, file) {
  return page.screenshot({ path: file ? path.join(output, `${prefix}${file}`) : undefined, scale: "css", animations: "disabled", caret: "hide" });
}

async function image(page, uri) {
  await page.evaluate((value) => globalThis.__paseoBackgroundProbe.setImage(value), uri);
}

async function foreground(page) {
  return page.getByTestId("workspace-header-title").evaluate((element) => {
    const opacities = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      opacities.push(getComputedStyle(ancestor).opacity);
    }
    return { color: getComputedStyle(element).color, opacities };
  });
}

(async () => {
  const browser = electronMode ? null : await chromium.launch({ headless: true });
  let electronApp;
  try {
    for (const size of [
      { name: "wide", width: 1440, height: 960 },
      ...(!electronMode ? [{ name: "compact-web", width: 390, height: 844 }] : []),
    ]) {
      let context;
      let page;
      if (electronMode) {
        const { _electron } = load("playwright");
        electronApp = await _electron.launch({
          executablePath: load("electron"),
          args: [path.join(__dirname, "electron-main.cjs")],
        });
        context = electronApp.context();
        await context.addInitScript(({ origins }) => {
          const origin = origins.find((item) => item.origin === location.origin);
          for (const item of origin?.localStorage ?? []) localStorage.setItem(item.name, item.value);
        }, JSON.parse(fs.readFileSync(state, "utf8")));
        page = await electronApp.firstWindow();
        await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
        results.electronVersion = await electronApp.evaluate(() => process.versions.electron);
      } else {
        context = await browser.newContext({
          storageState: state,
          viewport: { width: size.width, height: size.height },
          colorScheme: "dark",
          reducedMotion: "reduce",
        });
        page = await context.newPage();
      }
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const initialUrl = size.name === "wide" ? url : new URL(results.workspaceRoute, url).href;
      await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
      const workspaceRow = page.locator('[data-testid^="sidebar-workspace-row-"]');
      // The compact sidebar is hidden. Restore the workspace route observed
      // from the wide case rather than manufacturing application state.
      if (size.name === "wide") {
        await workspaceRow.first().waitFor({ timeout: 30000 });
        await workspaceRow.first().click();
        await page.getByTestId("workspace-pane-main").waitFor();
        results.workspaceRoute = new URL(page.url()).pathname;
      }
      await page.getByTestId("workspace-header-title").waitFor({ timeout: 30000 });
      screenshotCssWidth = await page.evaluate(() => innerWidth);
      await page.mouse.move(size.width - 5, size.height - 5);
      await page.waitForTimeout(700);
      const original = await snapshot(page, `${size.name}-original.png`);
      const beforeText = await foreground(page);
      await page.addScriptTag({ path: path.join(__dirname, "browser-probe.js") });
      await image(page, warm);
      const blockedWarm = await snapshot(page);
      await image(page, cool);
      const blockedCool = await snapshot(page, `${size.name}-image-only-blocked.png`);
      // Compact controls fill much of the center. Probe the empty left strip;
      // the cards intentionally keep their original opaque backgrounds.
      const region = size.name === "wide" ? [400, 150, 900, 650] : [5, 160, 15, 600];
      const blockedDifference = difference(blockedWarm, blockedCool, region);
      check(`${size.name}: image alone is hidden by existing surfaces`, blockedDifference.changedFraction < 0.01, blockedDifference);

      const points = size.name === "wide" ? [[100, 500], [1200, 300]] : [[size.width / 2, 250]];
      const surfaces = await page.evaluate((value) => globalThis.__paseoBackgroundProbe.adapt(value), points);
      await image(page, warm);
      const openWarm = await snapshot(page);
      await image(page, cool);
      const openCool = await snapshot(page);
      const visibleDifference = difference(openWarm, openCool, region);
      check(`${size.name}: background is visible through adapted surfaces`, visibleDifference.changedFraction > 0.7, visibleDifference);
      if (size.name === "wide") {
        const sidebarDifference = difference(openWarm, openCool, [20, 330, 260, 500]);
        check("wide: sidebar also shows the background", sidebarDifference.changedFraction > 0.7, sidebarDifference);
      }

      await page.evaluate(() => globalThis.__paseoBackgroundProbe.setSurfaceOpacity(1));
      await image(page, warm);
      const opaqueWarm = await snapshot(page);
      await image(page, cool);
      const opaqueCool = await snapshot(page);
      const opaqueDifference = difference(opaqueWarm, opaqueCool, region);
      check(`${size.name}: opaque surfaces hide the wallpaper`, opaqueDifference.changedFraction < 0.01, opaqueDifference);
      await page.evaluate(() => globalThis.__paseoBackgroundProbe.setSurfaceOpacity(0.45));

      await page.evaluate(() => globalThis.__paseoBackgroundProbe.setImageOpacity(0));
      const zeroCool = await snapshot(page);
      await image(page, warm);
      const zeroWarm = await snapshot(page);
      const zeroDifference = difference(zeroCool, zeroWarm, region);
      check(`${size.name}: zero image opacity hides image changes`, zeroDifference.changedFraction < 0.01, zeroDifference);
      await page.evaluate(() => globalThis.__paseoBackgroundProbe.setImageOpacity(0.8));
      await image(page, scenic);
      await snapshot(page, `${size.name}-background.png`);

      const afterText = await foreground(page);
      check(`${size.name}: text color and ancestor opacity are preserved`,
        beforeText.color === afterText.color && afterText.opacities.every((value) => value === "1"), { beforeText, afterText });
      const hitTest = await page.evaluate(() => {
        const layer = globalThis.__paseoBackgroundProbe.image;
        return { pointerEvents: getComputedStyle(layer).pointerEvents, elementAtCenterIsImage: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === layer };
      });
      check(`${size.name}: background does not intercept input`, hitTest.pointerEvents === "none" && !hitTest.elementAtCenterIsImage, hitTest);

      if (size.name === "wide") {
        await page.getByTestId("sidebar-sessions").click();
        await page.waitForURL("**/sessions", { timeout: 10000 });
        check("wide: background survives route navigation", await page.locator("#paseo-background-feasibility-probe").count() === 1);
        await page.locator('[data-testid^="sidebar-workspace-row-"]').first().click();
        await page.getByTestId("workspace-header-title").waitFor();
        await page.mouse.move(size.width - 5, size.height - 5);
        await page.waitForTimeout(700);
      }
      await page.evaluate(() => globalThis.__paseoBackgroundProbe.clear());
      check(`${size.name}: cleanup removes background`, await page.locator("#paseo-background-feasibility-probe").count() === 0);
      const restored = await snapshot(page, `${size.name}-restored.png`);
      // Returning to a workspace can focus the Agent button. Compare empty
      // surface pixels here, so a legitimate focus ring is not a wallpaper leak.
      const restoreRegion = size.name === "wide" ? [1150, 150, 250, 650] : [5, 160, 10, 600];
      const restoredDifference = difference(original, restored, restoreRegion);
      check(`${size.name}: cleanup restores original background pixels`, restoredDifference.changedFraction < 0.01, restoredDifference);
      check(`${size.name}: no application exceptions`, errors.length === 0, errors);
      results.cases.push({ name: size.name, viewport: size, adaptedSurfaces: surfaces });
      if (electronMode) {
        await electronApp.close();
        electronApp = null;
      } else await context.close();
    }
  } finally {
    if (electronApp) await electronApp.close();
    if (browser) await browser.close();
    fs.writeFileSync(path.join(output, `${prefix}results.json`), `${JSON.stringify(results, null, 2)}\n`);
  }
  console.log(JSON.stringify({ checks: results.checks.length, passed: results.checks.every((item) => item.passed), output }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
