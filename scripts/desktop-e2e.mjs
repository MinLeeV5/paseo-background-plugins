import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.PASEO_DESKTOP_EXECUTABLE ?? "/Applications/Paseo.app/Contents/MacOS/Paseo";
await fs.access(executable);
await fs.mkdir(path.join(root, ".local"), { recursive: true });
const home = await fs.mkdtemp(path.join(root, ".local", "desktop-e2e-"));
const profile = path.join(home, "profile");
const out = path.join(root, "verification", "installed");
await fs.mkdir(profile); await fs.mkdir(out, { recursive: true });
const exec = promisify(execFile);
const run = async (...args) => JSON.parse((await exec(process.env.PASEO_CLI ?? "paseo", [...args, "--home", home, "--json"], { maxBuffer: 2e6 })).stdout);
const port = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
});
const daemonPort = await port(), debugPort = await port();
await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ version: 1, pluginsEnabled: true,
  daemon: { listen: `127.0.0.1:${daemonPort}`, hostnames: ["localhost", "127.0.0.1"], cors: { allowedOrigins: ["paseo://app"] }, relay: { enabled: false }, mcp: { enabled: false } } }));
await fs.writeFile(path.join(profile, "desktop-settings.json"), JSON.stringify({ version: 1,
  settings: { releaseChannel: "stable", notifications: { playSound: false }, daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true } },
  migrations: { legacyRendererSettingsImported: true, daemonStopOnQuitDefaultApplied: true } }));
const log = await fs.open(path.join(home, "desktop.log"), "w");
let child, browser, started = false;
const checks = [], errors = [];
const check = (name) => { checks.push({ name }); console.log(`✓ ${name}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function expect(fn, message, ms = 15000) {
  const end = Date.now() + ms;
  do { if (await fn()) return; await wait(100); } while (Date.now() < end);
  throw new Error(message);
}
const imageSource = (page) => page.locator("#paseo-background-layer img").getAttribute("src");
async function range(page, id, value) {
  await page.getByTestId(`background-range-${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function save(page) { await page.getByTestId("background-save").click(); await page.getByTestId("background-saved-message").waitFor(); }
async function settings(page) { await page.getByText("Backgrounds", { exact: true }).first().click(); await page.getByTestId("background-preset-forest").waitFor(); }
async function workspace(page) { await page.locator('[data-testid^="sidebar-workspace-row-"]').first().click(); await page.locator('[data-testid^="workspace-pane-"]').first().waitFor(); }

try {
  await run("daemon", "start", "--timeout", "25"); started = true;
  await run("plugin", "install", root);
  const fixture = path.join(home, "workspace"); await fs.mkdir(fixture);
  await run("workspace", "create", "--isolation", "local", "--path", fixture, "--title", "Background verification");
  child = spawn(executable, [`--remote-debugging-port=${debugPort}`], { env: { ...process.env, PASEO_HOME: home, PASEO_ELECTRON_USER_DATA_DIR: profile, PASEO_TEST_APP_NAME: "Paseo Background Verification" }, stdio: ["ignore", log.fd, log.fd] });
  await expect(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.ok).catch(() => false), "Desktop CDP did not start", 40000);
  const runtime = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json());
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText(/^(Direct connection|直接连接)$/).waitFor({ timeout: 40000 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "language", { get: () => "en-US" });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText(/^(Direct connection|直接连接)$/).click({ timeout: 40000 });
  await page.getByRole("textbox", { name: /^(Host|主机)$/ }).fill("127.0.0.1");
  await page.getByRole("textbox", { name: /^(Port|端口)$/ }).fill(String(daemonPort));
  await page.getByRole("button", { name: /^(Connect|连接)$/ }).click();
  await settings(page);
  check("Official packaged Paseo desktop loads the installed plugin using its real preload and main process");
  await page.getByTestId("background-preset-coast").click();
  await range(page, "imageOpacity", 80);
  await range(page, "surfaceOpacity", 45);
  await range(page, "blurRadius", 3);
  await range(page, "brightness", 105);
  await expect(async () => await page.locator("#paseo-background-layer img").evaluate((node) => node.style.filter).catch(() => "") === "blur(3px) brightness(1.05)", "Desktop live parameters failed");
  await page.getByTestId("background-fit").getByRole("button").click();
  await page.getByText("Show the whole image", { exact: true }).last().click();
  await page.getByTestId("background-position").getByRole("button").click();
  await page.getByText("Top", { exact: true }).last().click();
  await expect(async () => await page.locator("#paseo-background-layer img").evaluate((node) => node.style.objectFit === "contain" && node.style.objectPosition === "center top"), "Desktop fit and position did not apply");
  await page.getByTestId("background-fit").getByRole("button").click();
  await page.getByText("Fill the view", { exact: true }).last().click();
  await page.getByTestId("background-position").getByRole("button").click();
  await page.getByText("Center", { exact: true }).last().click();
  await save(page);
  await workspace(page);
  await settings(page);
  await wait(200);
  await page.screenshot({ path: path.join(out, "desktop-settings.png") });
  await workspace(page);
  const saved = await imageSource(page);
  await wait(400);
  await page.screenshot({ path: path.join(out, "desktop-workspace.png") });
  check("Desktop preset, opacity, blur, brightness, fit and position preview, save and survive navigation");
  await page.reload();
  await expect(async () => await imageSource(page).catch(() => "") === saved, "Desktop reload lost the saved background", 30000);
  check("Desktop reload restores background without opening settings");
  await settings(page);
  await page.getByTestId("background-enabled").getByRole("switch").click();
  await expect(async () => await page.locator("#paseo-background-layer").count() === 0, "Desktop background switch did not clear the layer");
  await save(page);
  await page.reload();
  await page.getByTestId("background-preset-forest").waitFor({ timeout: 30000 });
  assert.equal(await page.locator("#paseo-background-layer").count(), 0);
  await page.getByTestId("background-preset-forest").click();
  await save(page);
  check("Desktop off switch removes the background and the saved off state survives reload");
  await run("plugin", "disable", "paseo-background");
  await expect(async () => await page.locator("#paseo-background-layer,#paseo-background-style,[data-paseo-background-surface]").count() === 0, "Desktop plugin disable leaked injected DOM");
  await run("plugin", "enable", "paseo-background");
  await expect(() => page.locator("#paseo-background-layer img").count(), "Desktop plugin enable did not restore the layer");
  assert.equal(await page.locator("#paseo-background-layer").count(), 1);
  check("Desktop plugin disable fully cleans up and enable restores one layer");
  assert.deepEqual(errors, []);
  check("No uncaught page errors in the packaged desktop workflow");
  await fs.writeFile(path.join(out, "desktop-results.json"), JSON.stringify({ date: new Date().toISOString(), paseo: "0.13.0-beta.1", client: "Unmodified official packaged macOS desktop application", runtime: { browser: runtime.Browser, userAgent: runtime["User-Agent"] }, checks, errors }, null, 2));
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(root, ".local", "desktop-failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  child?.kill("SIGKILL");
  if (started) await run("daemon", "stop").catch(() => {});
  await log.close();
}
