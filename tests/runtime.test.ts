import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createWebRuntime } from "../client/web";
import { defaults } from "../shared/settings";
import { deferred, fixture, settle } from "./dom";

let dom: ReturnType<typeof fixture>;
let handles: ReturnType<typeof createWebRuntime>[];
beforeEach(() => { dom = fixture(); handles = []; });
afterEach(() => { handles.forEach((h) => h.dispose()); dom.close(); });
function runtime(report = (_state: any) => {}) { const h = createWebRuntime(report); handles.push(h); return h; }
const enabled = () => ({ ...defaults(), enabled: true, profileId: "host-a", surfaceOpacity: 0.4 });

test("adapts only layout surfaces, preserves opaque controls, and restores React's latest styles", async () => {
  const states: string[] = [];
  const h = runtime((state) => states.push(state.status));
  h.update(enabled());
  await settle();
  assert.ok(dom.document.querySelector("#paseo-background-layer img"));
  const surface = dom.document.querySelector("section")!;
  assert.ok(surface.hasAttribute("data-paseo-background-surface"));
  assert.ok(dom.document.getElementById("paseo-background-style")!.textContent!.includes("background-color:rgba(25, 28, 33, 0.4)!important"));
  assert.equal(dom.window.getComputedStyle(dom.document.querySelector("button")!).backgroundColor, "rgb(90, 100, 110)");
  assert.ok(states.includes("active"));
  surface.style.backgroundColor = "rgb(180, 190, 200)";
  await settle();
  assert.ok(dom.document.getElementById("paseo-background-style")!.textContent!.includes("background-color:rgba(180, 190, 200, 0.4)!important"));
  h.dispose();
  assert.equal(dom.window.getComputedStyle(surface).backgroundColor, "rgb(180, 190, 200)");
  assert.equal(dom.document.querySelector("[data-paseo-background-surface],#paseo-background-layer,#paseo-background-style,[data-paseo-background-root]"), null);
});

test("adapts newly mounted chat regions without scanning for streamed text", async () => {
  let reports = 0;
  runtime(() => reports++).update(enabled());
  await settle();
  const chat = dom.document.createElement("article");
  chat.setAttribute("data-testid", "agent-chat-scroll");
  chat.style.backgroundColor = "rgb(40, 50, 60)";
  dom.document.querySelector("main")!.appendChild(chat);
  await settle();
  assert.ok(chat.hasAttribute("data-paseo-background-surface"));
  const before = reports;
  chat.appendChild(dom.document.createTextNode("streaming reply"));
  const row = dom.document.createElement("span");
  row.textContent = "new streamed row";
  chat.appendChild(row);
  row.className = "streaming-highlight";
  row.style.transform = "translateY(10px)";
  await settle();
  assert.equal(reports, before);
});

test("adapts cached workspaces when their transparent retained wrappers change visibility", async () => {
  const first = dom.document.querySelector("section")!;
  const wrapper = dom.document.createElement("div");
  first.replaceWith(wrapper);
  wrapper.appendChild(first);
  const cached = dom.document.createElement("div");
  cached.style.display = "none";
  cached.innerHTML = '<section data-testid="workspace-pane-cached" style="background-color:rgb(45, 50, 60)"></section>';
  dom.document.querySelector("main")!.appendChild(cached);
  runtime().update(enabled());
  await settle();
  assert.equal(wrapper.hasAttribute("data-paseo-background-surface"), false);
  const second = cached.querySelector("section")!;
  assert.equal(second.hasAttribute("data-paseo-background-surface"), false);
  for (const next of [cached, wrapper, cached, wrapper]) {
    wrapper.style.display = next === wrapper ? "flex" : "none";
    cached.style.display = next === cached ? "flex" : "none";
    await settle();
    assert.ok(next.querySelector("section")!.hasAttribute("data-paseo-background-surface"), "The newly visible workspace must be adapted without a focus or settings event");
    assert.equal(dom.document.querySelectorAll("#paseo-background-layer").length, 1);
  }
});

test("late image decode cannot recreate a disabled or disposed background", async () => {
  const loading = deferred<void>();
  dom.decode(() => loading.promise);
  const h = runtime();
  h.update(enabled());
  h.update({ ...enabled(), enabled: false });
  loading.resolve();
  await settle();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
  h.dispose();
  h.update(enabled());
  await settle();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
});

test("a failed replacement retains the loaded image and reports a visible error", async () => {
  let status = "";
  const h = runtime((state) => { status = state.status; });
  h.update(enabled());
  await settle();
  const original = dom.document.querySelector("#paseo-background-layer img");
  dom.decode(() => Promise.reject(new Error("Image decode failed")));
  h.update({ ...enabled(), source: { kind: "url", url: "https://example.com/broken.jpg" } });
  await settle();
  assert.equal(status, "error");
  assert.equal(dom.document.querySelector("#paseo-background-layer img"), original);
});

test("a newer selection wins an image loading race", async () => {
  const old = deferred<void>();
  dom.decode((image) => image.src.includes("slow.jpg") ? old.promise : Promise.resolve());
  const h = runtime();
  h.update({ ...enabled(), source: { kind: "url", url: "https://example.com/slow.jpg" } });
  h.update({ ...enabled(), source: { kind: "preset", id: "night" } });
  await settle();
  const selected = dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src");
  old.resolve();
  await settle();
  assert.equal(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), selected);
});

test("multiple hosts share one layer, preview temporarily, and remember the chosen host", async () => {
  const a = runtime();
  const b = runtime();
  a.update(enabled());
  b.update({ ...enabled(), profileId: "host-b", source: { kind: "preset", id: "dunes" } }, false, true);
  await settle();
  const chosen = dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src");
  a.update(enabled(), true);
  await settle();
  assert.notEqual(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), chosen);
  a.update(enabled());
  await settle();
  assert.equal(dom.document.querySelectorAll("#paseo-background-layer").length, 1);
  assert.equal(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), chosen);
  assert.equal(dom.window.localStorage.getItem("paseo-background:selected-profile:v1"), "host-b");
  a.dispose();
  assert.ok(dom.document.getElementById("paseo-background-layer"));
  b.dispose();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
  assert.equal((globalThis as any)[Symbol.for("MinLeeV5.paseo-background.manager.v1")], undefined);
});

test("rebuilds its layer if the app root is remounted", async () => {
  const h = runtime();
  h.update(enabled());
  await settle();
  const old = dom.document.getElementById("root")!;
  const root = dom.document.createElement("div");
  root.id = "root";
  root.innerHTML = '<section data-testid="workspace-pane-next" style="background-color:rgb(21, 22, 23)"></section>';
  old.replaceWith(root);
  dom.window.dispatchEvent(new dom.window.Event("focus"));
  await settle();
  assert.ok(root.querySelector("#paseo-background-layer img"));
  assert.equal(old.querySelector("[data-paseo-background-surface]"), null);
});
