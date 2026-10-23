import assert from "node:assert/strict";

const regionsSelector = '[data-testid^="workspace-pane-"],[data-testid="agent-chat-scroll"],[data-testid="composer-dock-header"],[data-testid="workspace-tabs-row"],[data-testid="workspace-explorer-sidebar"],[data-testid="files-pane-header"],[data-testid="file-explorer-tree-scroll"],[data-testid="changes-header"],[data-testid="changes-repository-header"],[data-testid="sidebar-project-workspace-list-scroll"],[data-testid="sidebar-footer"],[data-testid="message-input-root"],[data-background-viewport-fixture]';

export async function assertWorkspaceBackground(page, surfaceOpacity = 1) {
  const { surfaces, regions } = await page.evaluate((selector) => {
    const anchors = new Set(document.querySelectorAll(selector));
    for (const node of document.querySelectorAll('[data-testid="workspace-explorer-sidebar"] div')) {
      if (["auto", "scroll"].includes(getComputedStyle(node).overflowY) && !node.closest('.monaco-editor,.cm-editor,.xterm,[role="textbox"],[contenteditable="true"]')) anchors.add(node);
    }
    const alpha = (color) => color.startsWith("rgba(") ? Number(color.slice(5, -1).split(",")[3]) : color.startsWith("rgb(") ? 1 : 0;
    const tint = document.getElementById("paseo-background-tint");
    const themeAlpha = tint ? alpha(getComputedStyle(tint).backgroundColor) : 0;
    const nodes = new Set();
    const regions = [];
    for (const anchor of anchors) {
      const box = anchor.getBoundingClientRect();
      if (box.width < 140 || box.height <= 1) continue;
      let transmission = 1 - themeAlpha;
      for (let node = anchor; node && node.id !== "root"; node = node.parentElement) {
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 140 || bounds.height <= 1) continue;
        nodes.add(node);
        const color = getComputedStyle(node).backgroundColor;
        transmission *= 1 - alpha(color);
      }
      regions.push({ testID: anchor.getAttribute("data-testid") ?? "explorer-scroll-viewport", opacity: 1 - transmission });
    }
    const surfaces = [...nodes].map((node) => ({
      testID: node.getAttribute("data-testid"),
      marked: node.hasAttribute("data-paseo-background-surface"),
      color: getComputedStyle(node).backgroundColor,
    }));
    return { surfaces, regions };
  }, regionsSelector);
  const opaque = surfaces.filter((surface) => /^rgb\(/.test(surface.color) || /, 1\)$/.test(surface.color));
  assert.deepEqual(opaque, [], "Opaque workspace ancestors must not cover the saved background");
  assert.ok(surfaces.some((surface) => surface.marked), "The visible workspace must have adapted background surfaces");
  for (const region of regions) assert.ok(region.opacity <= surfaceOpacity + 0.005,
    `${region.testID}: composed opacity ${region.opacity.toFixed(4)} exceeds the configured ${surfaceOpacity}`);
  assert.equal(await page.locator("#paseo-background-layer").count(), 1);
  return { regions, maxCompositeOpacity: Math.max(...regions.map((region) => region.opacity)) };
}

export async function assertWorkspaceFrames(page, titles, surfaceOpacity) {
  await page.evaluate(({ selector, limit }) => {
    const state = { frames: 0, errors: [], stopped: false, image: document.querySelector("#paseo-background-layer img") };
    globalThis.__backgroundFrameCheck = state;
    const alpha = (node) => {
      const color = getComputedStyle(node).backgroundColor;
      return color.startsWith("rgba(") ? Number(color.slice(5, -1).split(",")[3]) : color.startsWith("rgb(") ? 1 : 0;
    };
    const frame = () => {
      if (state.stopped) return;
      state.frames++;
      const tint = document.getElementById("paseo-background-tint");
      if (document.querySelector("#paseo-background-layer img") !== state.image || !state.image?.isConnected) state.errors.push("Background image was replaced or removed");
      const anchors = new Set(document.querySelectorAll(selector));
      for (const node of document.querySelectorAll('[data-testid="workspace-explorer-sidebar"] div')) {
        if (["auto", "scroll"].includes(getComputedStyle(node).overflowY) && !node.closest('.monaco-editor,.cm-editor,.xterm,[role="textbox"],[contenteditable="true"]')) anchors.add(node);
      }
      for (const anchor of anchors) {
        const b = anchor.getBoundingClientRect();
        if (b.width < 140 || b.height <= 1) continue;
        let transmission = tint ? 1 - alpha(tint) : 1;
        for (let node = anchor; node && node.id !== "root"; node = node.parentElement) {
          const r = node.getBoundingClientRect();
          if (r.width >= 140 && r.height > 1) transmission *= 1 - alpha(node);
        }
        const opacity = 1 - transmission;
        if (opacity > limit + 0.005 && state.errors.length < 20) state.errors.push({ frame: state.frames, region: anchor.getAttribute("data-testid"), opacity });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { selector: regionsSelector, limit: surfaceOpacity });
  let result;
  try {
    for (const title of titles) await page.locator('[data-testid^="sidebar-workspace-row-"]').filter({ hasText: title }).first().click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  } finally {
    result = await page.evaluate(() => {
      const state = globalThis.__backgroundFrameCheck;
      state.stopped = true;
      delete globalThis.__backgroundFrameCheck;
      return { frames: state.frames, errors: state.errors };
    });
  }
  assert.ok(result.frames > 2, "Workspace switching must be sampled across rendering frames");
  assert.deepEqual(result.errors, [], "No rendered frame may expose opaque workspace, sidebar or header backgrounds");
  return result;
}

export async function assertPluginViewport(page, surfaceOpacity) {
  const explorer = page.locator('[data-testid="workspace-explorer-sidebar"]:visible');
  await explorer.evaluate((node) => {
    const viewport = document.createElement("div");
    viewport.setAttribute("data-background-viewport-fixture", "true");
    viewport.style.cssText = "position:absolute;inset:36px 0 0;overflow-y:auto;background-color:rgb(30,35,42);z-index:3";
    viewport.innerHTML = '<div data-background-card style="margin:16px;height:100px;background-color:rgb(60,70,80)">Plugin card</div>';
    node.appendChild(viewport);
  });
  try {
    const viewport = page.locator("[data-background-viewport-fixture]");
    await page.waitForFunction(() => document.querySelector("[data-background-viewport-fixture]")?.hasAttribute("data-paseo-background-surface"));
    assert.equal(await viewport.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    assert.equal(await page.locator("[data-background-card]").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(60, 70, 80)");
    return await assertWorkspaceBackground(page, surfaceOpacity);
  } finally {
    await page.locator("[data-background-viewport-fixture]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  }
}

// Exercise the nested layout of a populated conversation without starting an
// agent or depending on a provider account. Run inside a real Paseo pane.
export async function assertNestedChatBackground(page, surfaceOpacity, screenshotPath) {
  const pane = page.locator('[data-testid^="workspace-pane-"]:visible').first();
  await pane.evaluate((node) => {
    const fixture = document.createElement("div");
    fixture.setAttribute("data-background-test-fixture", "true");
    fixture.setAttribute("data-testid", "workspace-pane-background-fixture");
    fixture.style.cssText = "position:absolute;inset:48px 16px 16px;display:flex;flex-direction:column;background-color:rgb(30,35,42);z-index:2";
    fixture.innerHTML = '<header data-testid="workspace-header-title" style="height:36px;padding:8px">Conversation layout verification</header><article style="display:flex;flex:1;background-color:rgb(30,35,42)"><div data-testid="agent-chat-scroll" style="flex:1;padding:24px"><p>A quiet place to think.</p></div></article><footer style="height:96px;padding:16px;background-color:rgb(30,35,42)"><div data-testid="message-input-root"><button style="height:48px;width:180px;background-color:rgb(90,100,110)">Keep controls clear</button></div></footer>';
    node.appendChild(fixture);
  });
  try {
    await page.waitForFunction(() => document.querySelector('[data-background-test-fixture] article')?.hasAttribute("data-paseo-background-surface"));
    const result = await assertWorkspaceBackground(page, surfaceOpacity);
    const chat = result.regions.find((region) => region.testID === "agent-chat-scroll");
    assert.ok(chat && Math.abs(chat.opacity - surfaceOpacity) < 0.005, "The final chat opacity must match the configured slider");
    const control = page.locator('[data-background-test-fixture] button');
    assert.equal(await control.evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(90, 100, 110)");
    assert.equal(await control.evaluate((node) => getComputedStyle(node).opacity), "1");
    await page.screenshot({ path: screenshotPath });
    return result;
  } finally {
    await page.locator("[data-background-test-fixture]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  }
}
