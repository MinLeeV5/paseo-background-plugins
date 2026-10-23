import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { assertWorkspaceBackground, assertNestedChatBackground, assertWorkspaceFrames, assertPluginViewport } from "./workspace-checks.mjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.PASEO_APP_DIST ?? "/Applications/Paseo.app/Contents/Resources/app-dist";
const paseoVersion = process.env.PASEO_VERIFICATION_VERSION ?? "0.13.0-beta.1";
await fs.access(path.join(dist, "index.html"));
await fs.mkdir(path.join(root, ".local"), { recursive: true });
const home = await fs.mkdtemp(path.join(root, ".local", "e2e-"));
const out = path.resolve(root, process.env.PASEO_VERIFICATION_DIR ?? "verification/installed");
await fs.mkdir(out, { recursive: true });
const cli = process.env.PASEO_CLI ?? "paseo";
const run = async (...args) => JSON.parse((await exec(cli, [...args, "--home", home, "--json"], { maxBuffer: 2e6 })).stdout);
const port = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
});
const webPort = await port();
const daemonPort = await port();
const url = `http://127.0.0.1:${webPort}`;
await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ version: 1, pluginsEnabled: true,
  daemon: { listen: `127.0.0.1:${daemonPort}`, hostnames: ["localhost", "127.0.0.1"], cors: { allowedOrigins: [url] }, relay: { enabled: false }, mcp: { enabled: false } },
  app: { baseUrl: url } }));
const serve = spawn(process.execPath, ["verification/serve.cjs", "--dist", dist, "--port", String(webPort)], { cwd: root, stdio: "ignore" });
let browser;
let started = false;
const checks = [];
const errors = [];
const check = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(`✓ ${name}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function expect(fn, message, timeout = 15000) {
  const until = Date.now() + timeout;
  do { if (await fn()) return; await wait(100); } while (Date.now() < until);
  throw new Error(message);
}
function captureErrors(page) { page.on("pageerror", (error) => errors.push(error.message)); }
async function settings(page) {
  await page.getByText("Backgrounds", { exact: true }).first().click();
  await page.getByTestId("background-preset-forest").waitFor();
}
async function workspace(page, title = "Background verification") {
  await page.locator('[data-testid^="sidebar-workspace-row-"]').filter({ hasText: title }).first().click();
  await page.locator('[data-testid^="workspace-pane-"]:visible').first().waitFor();
}
async function range(page, id, value) {
  await page.getByTestId(`background-range-${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function save(page) {
  await page.getByTestId("background-save").click();
  await page.getByTestId("background-saved-message").waitFor();
}
const imageSource = (page) => page.locator("#paseo-background-layer img").getAttribute("src");
function difference(first, second, rect) {
  const a = PNG.sync.read(first), b = PNG.sync.read(second);
  const scale = a.width / 1440;
  let changed = 0, count = 0;
  for (let y = Math.ceil(rect.y * scale); y < Math.floor((rect.y + rect.height) * scale); y++) {
    for (let x = Math.ceil(rect.x * scale); x < Math.floor((rect.x + rect.width) * scale); x++) {
      const offset = (y * a.width + x) * 4;
      if (Math.max(...[0, 1, 2].map((i) => Math.abs(a.data[offset + i] - b.data[offset + i]))) > 3) changed++;
      count++;
    }
  }
  return changed / count;
}

try {
  await run("daemon", "start", "--timeout", "25"); started = true;
  const installation = await run("plugin", "install", root);
  assert.equal(installation.status, "running");
  const fixturePath = path.join(home, "workspace");
  await fs.mkdir(fixturePath);
  await run("workspace", "create", "--isolation", "local", "--path", fixturePath, "--title", "Background verification");
  const secondFixturePath = path.join(home, "workspace-next");
  await fs.mkdir(secondFixturePath);
  await run("workspace", "create", "--isolation", "local", "--path", secondFixturePath, "--title", "Second workspace verification");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US", colorScheme: "dark" });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  captureErrors(page);
  await page.goto(url);
  await page.getByText("Direct connection", { exact: true }).click({ timeout: 40000 });
  await page.getByRole("textbox", { name: "Host", exact: true }).fill("127.0.0.1");
  await page.getByRole("textbox", { name: "Port", exact: true }).fill(String(daemonPort));
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await settings(page);
  assert.equal(await page.locator("#paseo-background-layer").count(), 0);
  check("Installed plugin opens through the real Paseo sidebar; defaults are off");

  await page.getByTestId("background-preset-forest").click();
  await expect(() => page.locator("#paseo-background-layer img").count(), "Background image did not mount");
  await range(page, "imageOpacity", 85);
  await range(page, "surfaceOpacity", 35);
  await range(page, "blurRadius", 4);
  await range(page, "brightness", 110);
  await expect(async () => (await page.locator("#paseo-background-layer img").evaluate((img) => img.style.filter)) === "blur(4px) brightness(1.1)", "Live parameters did not apply");
  assert.equal(await page.locator("#paseo-background-layer img").evaluate((img) => img.style.opacity), "0.85");
  await save(page);
  check("Preset and all four sliders preview and save through settings RPC");
  const savedImage = await page.locator("#paseo-background-layer img").elementHandle();
  for (const title of ["Background verification", "Second workspace verification", "Background verification", "Second workspace verification", "Background verification"]) {
    await workspace(page, title);
    await wait(500);
    await assertWorkspaceBackground(page, 0.35);
    assert.ok(await savedImage.evaluate((image) => image.isConnected), "Workspace switching must reuse the loaded image");
  }
  for (const title of ["Second workspace verification", "Background verification", "Second workspace verification", "Background verification"]) await workspace(page, title);
  await wait(500);
  await assertWorkspaceBackground(page, 0.35);
  await savedImage.dispose();
  await page.screenshot({ path: path.join(out, "web-workspace-switch.png") });
  check("Two real workspaces preserve the background through five visits and four rapid cached switches");
  check("Workspace switches keep the background adapted on every sampled rendering frame",
    await assertWorkspaceFrames(page, ["Second workspace verification", "Background verification", "Second workspace verification", "Background verification", "Second workspace verification", "Background verification"], 0.35));
  await page.locator('[data-testid="workspace-explorer-toggle"]:visible').first().click();
  const explorer = page.locator('[data-testid="workspace-explorer-sidebar"]:visible');
  await explorer.waitFor();
  await explorer.getByTestId("workspace-tab-files").click();
  await page.locator('[data-testid="file-explorer-tree-scroll"]:visible,[data-testid="files-empty-area"]:visible').first().waitFor();
  await assertWorkspaceBackground(page, 0.35);
  await page.screenshot({ path: path.join(out, "web-sidebar-files.png") });
  await explorer.getByTestId("workspace-tab-changes_tree").click();
  await page.locator('[data-testid="changes-header"]:visible').waitFor();
  await assertWorkspaceBackground(page, 0.35);
  check("Left sidebar, explorer Files and Changes panels, and short headers share the theme tint");
  check("Unlabelled sidebar plugin scroll viewports share the background while cards remain opaque",
    await assertPluginViewport(page, 0.35));
  check("Nested conversation backgrounds compose to the configured opacity; controls remain opaque",
    await assertNestedChatBackground(page, 0.35, path.join(out, "web-chat-opacity.png")));
  await workspace(page);
  await wait(500);
  const forest = await imageSource(page);
  const first = await page.screenshot();
  const sidebar = await page.getByTestId("sidebar-project-workspace-list-scroll").boundingBox();
  const pane = await page.locator('[data-testid^="workspace-pane-"]:visible').first().boundingBox();
  const region = { x: pane.x + pane.width * 0.65, y: pane.y + pane.height * 0.2, width: pane.width * 0.25, height: pane.height * 0.3 };
  const textColor = await page.getByText("New tab", { exact: true }).first().evaluate((node) => getComputedStyle(node).color);
  await settings(page);
  await page.getByTestId("background-preset-night").click();
  await save(page);
  await workspace(page);
  await wait(500);
  const night = await imageSource(page);
  assert.notEqual(forest, night);
  const second = await page.screenshot({ path: path.join(out, "web-workspace.png") });
  const sidebarDifference = difference(first, second, sidebar);
  const workspaceDifference = difference(first, second, region);
  assert.ok(sidebarDifference > 0.2, `Sidebar pixels did not change (${sidebarDifference})`);
  assert.ok(workspaceDifference > 0.2, `Workspace pixels did not change (${workspaceDifference})`);
  assert.equal(await page.getByText("New tab", { exact: true }).first().evaluate((node) => getComputedStyle(node).color), textColor);
  assert.equal(await page.locator("#paseo-background-layer").evaluate((node) => getComputedStyle(node).pointerEvents), "none");
  check("Real screenshot pixels change in both workspace and sidebar; text and pointer events are preserved", { sidebarDifference, workspaceDifference });

  await page.reload();
  await expect(async () => await imageSource(page).catch(() => "") === night, "Saved background was not restored after reload", 30000);
  check("Saved background restores after browser reload without opening settings");
  const dark = await page.locator("#paseo-background-tint").evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(async () => await page.locator("#paseo-background-tint").evaluate((node) => getComputedStyle(node).backgroundColor) !== dark, "Surface colors did not follow the light theme");
  assert.equal(await imageSource(page), night);
  await page.screenshot({ path: path.join(out, "web-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(async () => await page.locator("#paseo-background-tint").evaluate((node) => getComputedStyle(node).backgroundColor) === dark, "Surface colors did not restore the dark theme");
  check("Surface blending follows light and dark theme changes without replacing the image");
  await settings(page);
  await page.getByTestId("background-preset-plum").click();
  await expect(async () => await imageSource(page) !== night, "Preview did not switch");
  await workspace(page);
  await expect(async () => await imageSource(page) === night, "Closing settings did not discard the unsaved preview");
  check("Leaving settings discards unsaved preview and restores the saved background");

  await settings(page);
  await page.getByTestId("background-url").fill("http://example.com/image.jpg");
  await page.getByTestId("background-use-url").click();
  await page.getByText("Enter a complete HTTPS image address.", { exact: true }).waitFor();
  await page.route("https://images.paseo-background.test/broken.png", (route) => route.fulfill({ contentType: "image/png", body: "not-an-image" }));
  await page.getByTestId("background-url").fill("https://images.paseo-background.test/broken.png");
  await page.getByTestId("background-use-url").click();
  await page.getByTestId("background-image-error").waitFor();
  assert.equal(await imageSource(page), night);
  await page.getByTestId("background-discard").click();
  check("Invalid URLs are rejected and failed image loads keep the last rendered background");

  const custom = new PNG({ width: 48, height: 48 });
  for (let i = 0; i < custom.data.length; i += 4) { custom.data[i] = 32; custom.data[i + 1] = 114; custom.data[i + 2] = 125; custom.data[i + 3] = 255; }
  await context.route("https://images.paseo-background.test/valid.png", (route) => route.fulfill({ contentType: "image/png", body: PNG.sync.write(custom) }));
  await page.getByTestId("background-url").fill("https://images.paseo-background.test/valid.png");
  await page.getByTestId("background-use-url").click();
  await expect(async () => await imageSource(page) === "https://images.paseo-background.test/valid.png", "HTTPS image was not applied");
  await save(page);
  check("A custom HTTPS image can be decoded, applied, and saved");
  await page.getByTestId("background-preset-night").click();
  await save(page);

  const other = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US", colorScheme: "dark", storageState: await context.storageState() });
  const peer = await other.newPage(); captureErrors(peer);
  await peer.goto(url);
  await settings(peer);
  await peer.getByTestId("background-preset-plum").click();
  await page.getByTestId("background-preset-coast").click();
  await save(page);
  const coast = await imageSource(page);
  await peer.getByTestId("background-save").click();
  await peer.getByTestId("background-save-error").waitFor();
  await peer.getByText("Reload saved values", { exact: true }).click();
  await expect(async () => await imageSource(peer) === coast && await peer.getByTestId("background-save-error").count() === 0, "Conflict reload did not restore the newer settings");
  await peer.getByTestId("background-preset-plum").click();
  await save(peer);
  const peerSource = await imageSource(peer);
  await expect(async () => await imageSource(page) === peerSource, "Other browser did not synchronize saved settings", 12000);
  check("Two clients synchronize host settings; stale saves are rejected and recover after reload");
  await other.close();

  await range(page, "imageOpacity", 0);
  await expect(async () => await page.locator("#paseo-background-layer").count() === 0, "Zero opacity left a background layer");
  await page.getByTestId("background-discard").click();
  await expect(() => page.locator("#paseo-background-layer img").count(), "Discard did not restore the background");
  check("Zero image opacity restores original surfaces and discard restores saved values");

  await page.getByTestId("background-fit").getByRole("button").click();
  await page.getByText("Show the whole image", { exact: true }).last().click();
  await page.getByTestId("background-position").getByRole("button").click();
  await page.getByText("Top", { exact: true }).last().click();
  await expect(async () => await page.locator("#paseo-background-layer img").evaluate((node) => node.style.objectFit === "contain" && node.style.objectPosition === "center top"), "Fit and position did not apply");
  await page.getByTestId("background-discard").click();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByTestId("background-preset-forest").click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByTestId("background-discard").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  check("Fit and position controls apply; settings remain usable in a 900px web window");

  await range(page, "imageOpacity", 80);
  await range(page, "surfaceOpacity", 45);
  await range(page, "blurRadius", 0);
  await range(page, "brightness", 100);
  await page.getByTestId("background-preset-forest").click();
  await save(page);
  await workspace(page);
  await settings(page);
  await wait(200);
  await page.screenshot({ path: path.join(out, "web-settings.png") });
  await workspace(page);
  await page.screenshot({ path: path.join(out, "web-forest.png") });

  await run("plugin", "disable", "paseo-background");
  await expect(async () => await page.locator("#paseo-background-layer,#paseo-background-style,[data-paseo-background-surface],[data-paseo-background-root]").count() === 0, "Disabling plugin did not clean all injected DOM");
  await page.screenshot({ path: path.join(out, "web-disabled.png") });
  await run("plugin", "enable", "paseo-background");
  await expect(() => page.locator("#paseo-background-layer img").count(), "Enabling plugin did not restore saved background");
  await run("plugin", "reload", "paseo-background");
  await wait(700);
  assert.equal(await page.locator("#paseo-background-layer").count(), 1);
  check("Disabling removes every injected surface; enabling and plugin reload restore exactly one layer");
  assert.deepEqual(errors, []);
  check("No uncaught page errors during the complete workflow");
  await fs.writeFile(path.join(out, "web-results.json"), JSON.stringify({ date: new Date().toISOString(), paseo: paseoVersion, client: "Official desktop app-dist in Chromium", checks, errors }, null, 2));
} catch (error) {
  if (browser) for (const c of browser.contexts()) for (const page of c.pages()) await page.screenshot({ path: path.join(root, ".local", "e2e-failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (started) await run("daemon", "stop").catch((error) => console.error("Test daemon cleanup:", error.message));
  serve.kill();
}
