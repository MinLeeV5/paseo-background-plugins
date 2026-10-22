// Diagnostic for an isolated Paseo web renderer, not a plugin implementation.
// It changes only ancestors of explicitly supplied probe points. Production
// plugins need bounded, versioned layout anchors and scoped styles instead of
// copying this point-based traversal and full style snapshot restoration.
(() => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Paseo root was not found");

  const original = new Map();
  const save = (element) => {
    if (!original.has(element)) {
      original.set(element, element.getAttribute("style"));
    }
  };
  const children = [...root.children];
  const image = document.createElement("img");
  image.id = "paseo-background-feasibility-probe";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  Object.assign(image.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
    zIndex: "0",
  });
  save(root);
  root.style.position = "relative";
  for (const child of children) {
    save(child);
    child.style.zIndex = "1";
    child.style.position = "relative";
  }
  root.prepend(image);
  const surfaces = new Map();

  function adapt(points, surfaceOpacity = 0.45) {
    const changes = [];
    for (const [x, y] of points) {
      let closestSurface = true;
      for (let element = document.elementFromPoint(x, y);
        element && element !== root;
        element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        const rgba = color.match(/[\d.]+/g)?.map(Number);
        if (!rgba || rgba.length < 3 || (rgba[3] ?? 1) === 0) continue;
        if (surfaces.has(element)) continue;
        save(element);
        const opacity = closestSurface ? surfaceOpacity : 0;
        closestSurface = false;
        surfaces.set(element, { color, opacity });
        element.style.backgroundColor = `rgba(${rgba.slice(0, 3).join(",")},${opacity})`;
        const box = element.getBoundingClientRect();
        changes.push({
          testId: element.getAttribute("data-testid"),
          className: element.className,
          previousColor: color,
          opacity,
          bounds: [box.x, box.y, box.width, box.height],
        });
      }
    }
    return changes;
  }

  function setSurfaceOpacity(value) {
    for (const [element, surface] of surfaces) {
      if (surface.opacity === 0) continue;
      const rgb = surface.color.match(/[\d.]+/g).slice(0, 3);
      element.style.backgroundColor = `rgba(${rgb.join(",")},${value})`;
    }
  }

  globalThis.__paseoBackgroundProbe = {
    image,
    adapt,
    setSurfaceOpacity,
    async setImage(uri) {
      image.src = uri;
      await image.decode();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
    setImageOpacity(value) { image.style.opacity = String(value); },
    setBlur(value) { image.style.filter = `blur(${value}px)`; },
    clear() {
      image.remove();
      for (const [element, style] of original) {
        if (style === null) element.removeAttribute("style");
        else element.setAttribute("style", style);
      }
      delete globalThis.__paseoBackgroundProbe;
    },
  };
})();
