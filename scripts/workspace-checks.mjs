import assert from "node:assert/strict";

export async function assertWorkspaceBackground(page, surfaceOpacity = 1) {
  const { surfaces, regions } = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('[data-testid^="workspace-pane-"], [data-testid="agent-chat-scroll"]')];
    const nodes = new Set();
    const regions = [];
    for (const anchor of anchors) {
      const box = anchor.getBoundingClientRect();
      if (box.width < 140 || box.height < 140) continue;
      let transmission = 1;
      for (let node = anchor; node && node.id !== "root"; node = node.parentElement) {
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 140 || bounds.height < 140) continue;
        nodes.add(node);
        const color = getComputedStyle(node).backgroundColor;
        const alpha = color.startsWith("rgba(") ? Number(color.slice(5, -1).split(",")[3]) : color.startsWith("rgb(") ? 1 : 0;
        transmission *= 1 - alpha;
      }
      regions.push({ testID: anchor.getAttribute("data-testid"), opacity: 1 - transmission });
    }
    const surfaces = [...nodes].map((node) => ({
      testID: node.getAttribute("data-testid"),
      marked: node.hasAttribute("data-paseo-background-surface"),
      color: getComputedStyle(node).backgroundColor,
    }));
    return { surfaces, regions };
  });
  const opaque = surfaces.filter((surface) => /^rgb\(/.test(surface.color) || /, 1\)$/.test(surface.color));
  assert.deepEqual(opaque, [], "Opaque workspace ancestors must not cover the saved background");
  assert.ok(surfaces.some((surface) => surface.marked), "The visible workspace must have adapted background surfaces");
  for (const region of regions) assert.ok(region.opacity <= surfaceOpacity + 0.005,
    `${region.testID}: composed opacity ${region.opacity.toFixed(4)} exceeds the configured ${surfaceOpacity}`);
  assert.equal(await page.locator("#paseo-background-layer").count(), 1);
  return { regions, maxCompositeOpacity: Math.max(...regions.map((region) => region.opacity)) };
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
    fixture.innerHTML = '<header data-testid="workspace-header-title" style="height:36px;padding:8px">Conversation layout verification</header><article style="display:flex;flex:1;background-color:rgb(30,35,42)"><div data-testid="agent-chat-scroll" style="flex:1;padding:24px"><p>A quiet place to think.</p><button style="height:30px;width:120px;background-color:rgb(90,100,110)">Keep controls clear</button></div></article>';
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
