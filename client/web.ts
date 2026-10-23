import type { BackgroundSettings } from "../shared/settings";
import { sourceUri, withOpacity } from "../shared/settings";

// Narrow browser contracts keep the plugin's shared/React Native typecheck free
// of the DOM library. This module is entered only after Platform.OS === "web".
interface Style {
  setProperty(name: string, value: string, priority?: string): void;
  removeProperty(name: string): string;
}
interface Element {
  nodeType: number;
  id: string;
  tagName: string;
  style: Style;
  textContent: string | null;
  parentElement: Element | null;
  children: Iterable<Element>;
  isConnected: boolean;
  src: string;
  value: string;
  type: string;
  min: string;
  max: string;
  step: string;
  disabled: boolean;
  decode(): Promise<void>;
  matches(selector: string): boolean;
  closest(selector: string): Element | null;
  contains(node: Element): boolean;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Iterable<Element>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  appendChild(node: Element): void;
  prepend(node: Element): void;
  remove(): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}
interface RecordChange {
  type: string;
  target: Element;
  addedNodes: Iterable<Element>;
  removedNodes: Iterable<Element>;
}
declare const document: {
  head: Element;
  documentElement: Element;
  visibilityState: string;
  getElementById(id: string): Element | null;
  createElement(tag: string): Element;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Iterable<Element>;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare const window: {
  navigator: { language: string };
  crypto: { randomUUID(): string };
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
};
declare const getComputedStyle: (element: Element) => { backgroundColor: string };
declare const MutationObserver: new (callback: (records: RecordChange[]) => void) => {
  observe(node: Element, options: object): void;
  disconnect(): void;
};

export interface RuntimeState {
  status: "off" | "loading" | "active" | "partial" | "error" | "other-host";
  surfaces: number;
  error: string | null;
}
type Owner = { values: BackgroundSettings; report(state: RuntimeState): void; preview: boolean };
const MARK = "data-paseo-background-surface";
const OWNED = "data-paseo-background-owned";
const ROOT_MARK = "data-paseo-background-root";
const STORAGE = "paseo-background:selected-profile:v1";
const ANCHORS = [
  '[data-testid="sidebar-project-workspace-list-scroll"]',
  '[data-testid^="workspace-pane-"]',
  '[data-testid="workspace-header-title"]',
  '[data-testid="composer-dock-header"]',
  '[data-testid="paseo-background-settings"]',
  '[data-testid="agent-chat-scroll"]',
].join(",");

class BackgroundManager {
  private owners = new Map<symbol, Owner>();
  private patched = new Map<Element, string | null>();
  private layoutNodes = new Set<Element>();
  private root: Element | null = null;
  private style: Element | null = null;
  private layer: Element | null = null;
  private image: Element | null = null;
  private uri = "";
  private loadingUri = "";
  private generation = 0;
  private timer: number | null = null;
  private loadTimer: number | null = null;
  private observer: InstanceType<typeof MutationObserver> | null = null;
  private active: symbol | null = null;
  private preferred: string | null = null;
  private lastState: RuntimeState = { status: "off", surfaces: 0, error: null };

  constructor() {
    try { this.preferred = window.localStorage.getItem(STORAGE); } catch { /* Storage can be disabled. */ }
  }

  update(token: symbol, owner: Owner, claim = false) {
    this.owners.set(token, owner);
    if (claim && owner.values.profileId) {
      this.preferred = owner.values.profileId;
      try { window.localStorage.setItem(STORAGE, this.preferred); } catch { /* Session selection still works. */ }
    }
    this.render();
  }

  remove(token: symbol) {
    this.owners.delete(token);
    this.render();
  }

  get empty() { return this.owners.size === 0; }

  private cancelLoad() {
    ++this.generation;
    if (this.loadTimer !== null) window.clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.loadingUri = "";
  }

  private report(state: RuntimeState) {
    this.lastState = state;
    for (const [token, owner] of this.owners) {
      owner.report(token === this.active ? state : {
        status: owner.values.enabled && this.active ? "other-host" : "off", surfaces: 0, error: null,
      });
    }
  }

  private render() {
    const candidates = [...this.owners].filter(([, owner]) => owner.values.enabled && owner.values.imageOpacity > 0);
    const preview = candidates.filter(([, owner]) => owner.preview).at(-1);
    const selected = preview ?? candidates.find(([, owner]) => owner.values.profileId === this.preferred)
      ?? (!this.preferred ? candidates.sort((a, b) => a[1].values.profileId.localeCompare(b[1].values.profileId))[0] : undefined);
    this.active = selected?.[0] ?? null;
    if (!selected) {
      this.clear();
      this.report({ status: "off", surfaces: 0, error: null });
      return;
    }
    const values = selected[1].values;
    const uri = sourceUri(values);
    if (this.uri === uri && this.image) {
      this.cancelLoad();
      this.ensureLayer();
      this.paint(values);
      this.schedule();
      this.report(this.lastState);
      return;
    }
    if (this.loadingUri === uri) return;
    this.cancelLoad();
    const generation = this.generation;
    this.loadingUri = uri;
    this.report({ status: "loading", surfaces: this.patched.size, error: null });
    const image = document.createElement("img");
    image.setAttribute("alt", "");
    image.setAttribute("aria-hidden", "true");
    image.setAttribute(OWNED, "image");
    image.src = uri;
    this.loadTimer = window.setTimeout(() => {
      if (generation !== this.generation || !this.loadingUri) return;
      this.cancelLoad();
      this.report({ status: "error", surfaces: this.patched.size, error: "Image loading timed out. Check the URL and try again." });
    }, 20000);
    void image.decode().then(() => {
      if (generation !== this.generation || !this.active) return;
      this.ensureLayer();
      if (!this.layer) throw new Error("Paseo's app root was not found.");
      this.image?.remove();
      this.image = image;
      this.layer.appendChild(image);
      this.uri = uri;
      this.loadingUri = "";
      const current = this.owners.get(this.active);
      if (current) this.paint(current.values);
      this.refresh();
    }).catch((error: unknown) => {
      if (generation !== this.generation) return;
      this.loadingUri = "";
      this.report({ status: "error", surfaces: this.patched.size, error: error instanceof Error ? error.message : "The image could not be loaded." });
    }).finally(() => {
      if (generation === this.generation && this.loadTimer !== null) {
        window.clearTimeout(this.loadTimer);
        this.loadTimer = null;
      }
    });
  }

  private ensureLayer() {
    const root = document.getElementById("root");
    if (!root) return;
    if (this.root === root && this.layer?.isConnected) return;
    this.detach();
    this.root = root;
    root.setAttribute(ROOT_MARK, "true");
    this.layer = document.createElement("div");
    this.layer.id = "paseo-background-layer";
    this.layer.setAttribute(OWNED, "layer");
    this.layer.setAttribute("aria-hidden", "true");
    root.prepend(this.layer);
    if (this.image) this.layer.appendChild(this.image);
    this.style = document.createElement("style");
    this.style.id = "paseo-background-style";
    this.style.setAttribute(OWNED, "style");
    document.head.appendChild(this.style);
    this.observer = new MutationObserver((records) => {
      const changed = records.some((record) => {
        if (record.target.closest(`[${OWNED}]`)) return false;
        // Retained workspaces change visibility on transparent wrappers. Those
        // nodes need observation even though their backgrounds are not patched.
        if (record.type === "attributes") return this.layoutNodes.has(record.target) || record.target.matches(ANCHORS);
        return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 &&
          !node.getAttribute(OWNED) && (node.matches(ANCHORS) || Boolean(node.querySelector(ANCHORS))));
      });
      if (changed) this.schedule();
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-testid"] });
    window.addEventListener("resize", this.schedule);
    window.addEventListener("focus", this.schedule);
  }

  private paint(values: BackgroundSettings) {
    if (!this.image || !this.layer) return;
    const pad = values.blurRadius * 3;
    const rules: Record<string, string> = {
      position: "absolute", inset: `${-pad}px`, width: `calc(100% + ${pad * 2}px)`, height: `calc(100% + ${pad * 2}px)`,
      "object-fit": values.fit, "object-position": values.position,
      opacity: String(values.imageOpacity), filter: `blur(${values.blurRadius}px) brightness(${values.brightness})`,
      "pointer-events": "none", "user-select": "none",
    };
    for (const [key, value] of Object.entries(rules)) this.image.style.setProperty(key, value);
  }

  private schedule = () => {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.refresh(); }, 100);
  };

  private refresh() {
    if (!this.active || !this.image) return;
    this.ensureLayer();
    if (!this.root?.isConnected || !this.style) {
      this.report({ status: "partial", surfaces: 0, error: "Paseo's app root was not found." });
      return;
    }
    const owner = this.owners.get(this.active);
    if (!owner) return;
    for (const [node, previous] of this.patched) {
      if (previous === null) node.removeAttribute(MARK);
      else node.setAttribute(MARK, previous);
    }
    this.patched.clear();
    this.layoutNodes.clear();
    this.layoutNodes.add(this.root);
    const surfaces = new Map<Element, { color: string; tint: boolean }>();
    for (const anchor of document.querySelectorAll(ANCHORS)) {
      if (anchor.closest(`[${OWNED}]`)) continue;
      const box = anchor.getBoundingClientRect();
      const visible = box.width > 0 && box.height > 0;
      let first = true;
      for (let node: Element | null = anchor; node && node !== this.root; node = node.parentElement) {
        // Include hidden and zero-size paths so showing a cached workspace
        // schedules a refresh without requiring a remount or window focus.
        this.layoutNodes.add(node);
        if (!visible) continue;
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 140 || bounds.height < 140) continue;
        const color = getComputedStyle(node).backgroundColor;
        if (!withOpacity(color, 1)) continue;
        const existing = surfaces.get(node);
        if (!existing) surfaces.set(node, { color, tint: first });
        // Never tint a common ancestor again after another region cleared it.
        first = false;
      }
    }
    const css = [
      `[${ROOT_MARK}="true"]{position:relative!important;isolation:isolate!important}`,
      `[${ROOT_MARK}="true"]> :not([${OWNED}]){position:relative;z-index:1}`,
      `#paseo-background-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0;contain:strict}`,
    ];
    let index = 0;
    for (const [node, surface] of surfaces) {
      const id = String(index++);
      this.patched.set(node, node.getAttribute(MARK));
      node.setAttribute(MARK, id);
      css.push(`[${MARK}="${id}"]{background-color:${surface.tint ? withOpacity(surface.color, owner.values.surfaceOpacity) : "transparent"}!important}`);
    }
    this.style.textContent = css.join("\n");
    this.report({ status: surfaces.size > 1 ? "active" : "partial", surfaces: surfaces.size,
      error: surfaces.size > 1 ? null : "This page has no supported background regions yet." });
  }

  private detach() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("focus", this.schedule);
    for (const [node, previous] of this.patched) {
      if (previous === null) node.removeAttribute(MARK);
      else node.setAttribute(MARK, previous);
    }
    this.patched.clear();
    this.layoutNodes.clear();
    this.root?.removeAttribute(ROOT_MARK);
    this.layer?.remove();
    this.style?.remove();
    this.layer = null;
    this.style = null;
    this.root = null;
  }

  private clear() {
    this.cancelLoad();
    this.uri = "";
    this.image = null;
    this.detach();
  }
}

const sharedKey = Symbol.for("MinLeeV5.paseo-background.manager.v1");
function manager(): BackgroundManager {
  const scope = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;
  return scope[sharedKey] ?? (scope[sharedKey] = new BackgroundManager());
}

export function createWebRuntime(report: (state: RuntimeState) => void) {
  const token = Symbol("background-installation");
  const shared = manager();
  let disposed = false;
  return {
    update(values: BackgroundSettings, preview = false, claim = false) { if (!disposed) shared.update(token, { values, report, preview }, claim); },
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.remove(token);
      const scope = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;
      if (shared.empty && scope[sharedKey] === shared) delete scope[sharedKey];
    },
  };
}

export function language(): "en" | "zh" { return window.navigator.language.startsWith("zh") ? "zh" : "en"; }
export function profileId() { return window.crypto.randomUUID(); }
export function isVisible() { return document.visibilityState !== "hidden"; }
export function after(callback: () => void, milliseconds: number) {
  const id = window.setTimeout(callback, milliseconds);
  return () => window.clearTimeout(id);
}
export function onWake(callback: () => void) {
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", callback);
  return () => { window.removeEventListener("focus", callback); document.removeEventListener("visibilitychange", callback); };
}

export function mountRange(node: unknown, options: {
  id: string; label: string; value: number; min: number; max: number; step: number; accent: string;
  onChange(value: number): void;
}) {
  const parent = node as Element | null;
  if (!parent?.appendChild) return { update(_value: number) {}, dispose() {} };
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  input.setAttribute("aria-label", options.label);
  input.setAttribute("data-testid", `background-range-${options.id}`);
  input.setAttribute(OWNED, "range");
  input.style.setProperty("width", "100%");
  input.style.setProperty("height", "28px");
  input.style.setProperty("margin", "0");
  input.style.setProperty("accent-color", options.accent);
  input.style.setProperty("cursor", "pointer");
  const change = () => options.onChange(Number(input.value));
  input.addEventListener("input", change);
  parent.appendChild(input);
  return {
    update(value: number) { input.value = String(value); },
    dispose() { input.removeEventListener("input", change); input.remove(); },
  };
}

export function previewFilter(node: unknown, values: BackgroundSettings) {
  const element = node as Element | null;
  element?.style?.setProperty("filter", `blur(${values.blurRadius}px) brightness(${values.brightness})`);
}
