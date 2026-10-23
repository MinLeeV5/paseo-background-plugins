import assert from "node:assert/strict";

export async function assertWorkspaceBackground(page) {
  const surfaces = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('[data-testid^="workspace-pane-"], [data-testid="agent-chat-scroll"]')];
    const nodes = new Set();
    for (const anchor of anchors) {
      const box = anchor.getBoundingClientRect();
      if (box.width < 140 || box.height < 140) continue;
      for (let node = anchor; node && node.id !== "root"; node = node.parentElement) {
        const bounds = node.getBoundingClientRect();
        if (bounds.width >= 140 && bounds.height >= 140) nodes.add(node);
      }
    }
    return [...nodes].map((node) => ({
      testID: node.getAttribute("data-testid"),
      marked: node.hasAttribute("data-paseo-background-surface"),
      color: getComputedStyle(node).backgroundColor,
    }));
  });
  const opaque = surfaces.filter((surface) => /^rgb\(/.test(surface.color) || /, 1\)$/.test(surface.color));
  assert.deepEqual(opaque, [], "Opaque workspace ancestors must not cover the saved background");
  assert.ok(surfaces.some((surface) => surface.marked), "The visible workspace must have adapted background surfaces");
  assert.equal(await page.locator("#paseo-background-layer").count(), 1);
}
