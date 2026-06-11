(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const els = {
    pattern: document.getElementById("pattern"),
    algorithm: document.getElementById("algorithm"),
    scale: document.getElementById("scale"),
    scaleValue: document.getElementById("scale-value"),
    intensity: document.getElementById("intensity"),
    intensityValue: document.getElementById("intensity-value"),
    gridSize: document.getElementById("grid-size"),
    gridSizeValue: document.getElementById("grid-size-value"),
    opacity: document.getElementById("opacity"),
    opacityValue: document.getElementById("opacity-value"),
    colorOptions: document.getElementById("color-options"),
    regenerate: document.getElementById("regenerate"),
    export: document.getElementById("export"),
    exportSvg: document.getElementById("export-svg"),
  };

  const COLORS = {
    white: { grid: [245, 245, 245], bg: [10, 10, 10] },
    black: { grid: [17, 17, 17], bg: [236, 236, 236] },
    blue: { grid: [125, 167, 255], bg: [10, 10, 10] },
  };

  const state = {
    pattern: "lines",
    algorithm: "perlin",
    scale: 120,
    intensity: 1.5,
    gridSize: 24,
    opacity: 1,
    color: "white",
    seed: Math.floor(Math.random() * 0xffffffff),
  };

  // --- Seeded RNG (mulberry32) ---

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Permutation table shared by Perlin / Simplex / fBm ---

  let perm = new Uint8Array(512);

  function buildPermTable(seed) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }

  // --- Perlin noise ---

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + t * (b - a);
  }

  function grad(hash, x, y) {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  // Returns roughly [-1, 1]
  function perlin(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const val = lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
    // Classic Perlin's theoretical range is +/- sqrt(2)/2; stretch to [-1, 1]
    return val * 1.414;
  }

  // --- Simplex noise (2D, Gustavson's implementation) ---

  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const SIMPLEX_GRAD = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  // Returns roughly [-1, 1]
  function simplex(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = SIMPLEX_GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = SIMPLEX_GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = SIMPLEX_GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  }

  // --- fBm: 5 octaves of Perlin ---

  function fbm(x, y) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let max = 0;
    for (let o = 0; o < 5; o++) {
      value += amplitude * perlin(x * frequency, y * frequency);
      max += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / max;
  }

  // --- Cellular (Worley): F1 distance on a jittered cell grid ---

  function cellPoint(cx, cy, seed) {
    // Deterministic per-cell feature point via a hashed RNG
    const h = mulberry32((cx * 73856093) ^ (cy * 19349663) ^ seed);
    return [cx + h(), cy + h()];
  }

  // Returns [0, 1]: dark at feature points, bright between them
  function worley(x, y, seed) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let minDist = Infinity;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const [px, py] = cellPoint(cx + ox, cy + oy, seed);
        const dx = x - px;
        const dy = y - py;
        const d = dx * dx + dy * dy;
        if (d < minDist) minDist = d;
      }
    }
    return Math.min(1, Math.sqrt(minDist));
  }

  // --- Noise map generation (pass 1) ---

  function generateNoiseMap() {
    const map = new Float32Array(W * H);
    // Higher scale zooms out: more noise units span the canvas
    const freq = state.scale / 40000;
    const intensity = state.intensity;

    for (let y = 0; y < H; y++) {
      const ny = y * freq;
      for (let x = 0; x < W; x++) {
        const nx = x * freq;
        let v;
        switch (state.algorithm) {
          case "simplex":
            v = (simplex(nx, ny) + 1) / 2;
            break;
          case "fbm":
            v = (fbm(nx, ny) + 1) / 2;
            break;
          case "cellular":
            v = worley(nx * 4, ny * 4, state.seed);
            break;
          default:
            v = (perlin(nx, ny) + 1) / 2;
        }
        // Intensity is a contrast curve around the midpoint
        v = (v - 0.5) * intensity + 0.5;
        map[y * W + x] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
    return map;
  }

  // --- Grid rendering (pass 2) ---

  // Gap between squares so adjacent cells read as a mosaic, not a solid wash
  function squareGap(gridSize) {
    return Math.max(1, Math.round(gridSize * 0.15));
  }

  // One noise sample at the cell center drives the whole square
  function cellAlpha(noise, cx, cy, gridSize) {
    const sx = Math.min(W - 1, cx + (gridSize >> 1));
    const sy = Math.min(H - 1, cy + (gridSize >> 1));
    return noise[sy * W + sx] * state.opacity;
  }

  // Builds the texture as ImageData. With transparent=true the background is
  // left fully transparent and the noise mask goes into the alpha channel,
  // so the exported PNG composites cleanly over anything.
  function buildImage(targetCtx, transparent) {
    const noise = generateNoiseMap();
    const { grid, bg } = COLORS[state.color];
    const gridSize = state.gridSize;
    const opacity = state.opacity;
    const image = targetCtx.createImageData(W, H);
    const data = image.data;

    if (!transparent) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = bg[0];
        data[i + 1] = bg[1];
        data[i + 2] = bg[2];
        data[i + 3] = 255;
      }
    }

    function plot(i, a) {
      if (transparent) {
        data[i] = grid[0];
        data[i + 1] = grid[1];
        data[i + 2] = grid[2];
        data[i + 3] = a * 255;
      } else {
        data[i] = bg[0] + (grid[0] - bg[0]) * a;
        data[i + 1] = bg[1] + (grid[1] - bg[1]) * a;
        data[i + 2] = bg[2] + (grid[2] - bg[2]) * a;
      }
    }

    if (state.pattern === "squares") {
      const gap = squareGap(gridSize);
      for (let cy = 0; cy < H; cy += gridSize) {
        for (let cx = 0; cx < W; cx += gridSize) {
          const a = cellAlpha(noise, cx, cy, gridSize);
          const xEnd = Math.min(W, cx + gridSize - gap);
          const yEnd = Math.min(H, cy + gridSize - gap);
          for (let y = cy; y < yEnd; y++) {
            for (let x = cx; x < xEnd; x++) plot((y * W + x) * 4, a);
          }
        }
      }
    } else {
      for (let y = 0; y < H; y++) {
        const onRow = y % gridSize === 0;
        for (let x = 0; x < W; x++) {
          if (onRow || x % gridSize === 0) {
            plot((y * W + x) * 4, noise[y * W + x] * opacity);
          }
        }
      }
    }
    return image;
  }

  function render() {
    ctx.putImageData(buildImage(ctx, false), 0, 0);
  }

  // Builds the texture as an SVG string: grid lines become 1px rects whose
  // fill-opacity carries the noise mask. Consecutive pixels with the same
  // quantized alpha are merged into one rect to keep the file small, and
  // fully transparent runs are dropped. Background is transparent.
  function buildSVG() {
    const noise = generateNoiseMap();
    const { grid } = COLORS[state.color];
    const gridSize = state.gridSize;
    const opacity = state.opacity;
    const parts = [];

    // Alpha quantized to 1/100 so smooth noise produces mergeable runs
    const alphaAt = (x, y) => Math.round(noise[y * W + x] * opacity * 100) / 100;

    function flushRun(horizontal, line, start, end, alpha) {
      if (alpha <= 0 || end <= start) return;
      const rect = horizontal
        ? `x="${start}" y="${line}" width="${end - start}" height="1"`
        : `x="${line}" y="${start}" width="1" height="${end - start}"`;
      parts.push(`<rect ${rect} fill-opacity="${alpha}"/>`);
    }

    if (state.pattern === "squares") {
      // One rect per cell, opacity from the noise sample at its center
      const gap = squareGap(gridSize);
      for (let cy = 0; cy < H; cy += gridSize) {
        for (let cx = 0; cx < W; cx += gridSize) {
          const a = Math.round(cellAlpha(noise, cx, cy, gridSize) * 100) / 100;
          if (a <= 0) continue;
          const w = Math.min(gridSize - gap, W - cx);
          const h = Math.min(gridSize - gap, H - cy);
          parts.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill-opacity="${a}"/>`);
        }
      }
    } else {
      // Horizontal grid lines
      for (let y = 0; y < H; y += gridSize) {
        let runStart = 0;
        let runAlpha = -1;
        for (let x = 0; x <= W; x++) {
          const a = x < W ? alphaAt(x, y) : -1;
          if (a !== runAlpha) {
            flushRun(true, y, runStart, x, runAlpha);
            runStart = x;
            runAlpha = a;
          }
        }
      }

      // Vertical grid lines, skipping pixels the horizontal pass already drew
      for (let x = 0; x < W; x += gridSize) {
        let runStart = 0;
        let runAlpha = -1;
        for (let y = 0; y <= H; y++) {
          const onRow = y >= H || y % gridSize === 0;
          const a = onRow ? -1 : alphaAt(x, y);
          if (a !== runAlpha) {
            flushRun(false, x, runStart, y, runAlpha);
            runStart = y;
            runAlpha = a;
          }
        }
      }
    }

    const color = `rgb(${grid[0]},${grid[1]},${grid[2]})`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<g fill="${color}">${parts.join("")}</g></svg>`
    );
  }

  // --- Controls ---

  function syncOutputs() {
    els.scaleValue.textContent = state.scale;
    els.intensityValue.textContent = state.intensity.toFixed(1);
    els.gridSizeValue.textContent = state.gridSize + "px";
    els.opacityValue.textContent = state.opacity.toFixed(2).replace(/0$/, "");
  }

  els.pattern.addEventListener("change", () => {
    state.pattern = els.pattern.value;
    render();
  });

  els.algorithm.addEventListener("change", () => {
    state.algorithm = els.algorithm.value;
    render();
  });

  els.scale.addEventListener("input", () => {
    state.scale = Number(els.scale.value);
    syncOutputs();
    render();
  });

  els.intensity.addEventListener("input", () => {
    state.intensity = Number(els.intensity.value);
    syncOutputs();
    render();
  });

  els.gridSize.addEventListener("input", () => {
    state.gridSize = Number(els.gridSize.value);
    syncOutputs();
    render();
  });

  els.opacity.addEventListener("input", () => {
    state.opacity = Number(els.opacity.value);
    syncOutputs();
    render();
  });

  els.colorOptions.addEventListener("click", (e) => {
    const button = e.target.closest(".swatch");
    if (!button) return;
    state.color = button.dataset.color;
    els.colorOptions.querySelectorAll(".swatch").forEach((s) => {
      s.classList.toggle("selected", s === button);
    });
    render();
  });

  els.regenerate.addEventListener("click", () => {
    state.seed = Math.floor(Math.random() * 0xffffffff);
    buildPermTable(state.seed);
    render();
  });

  els.export.addEventListener("click", () => {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = W;
    exportCanvas.height = H;
    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.putImageData(buildImage(exportCtx, true), 0, 0);
    const link = document.createElement("a");
    link.download = "noise-grid-texture.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });

  els.exportSvg.addEventListener("click", () => {
    const blob = new Blob([buildSVG()], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "noise-grid-texture.svg";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  });

  // --- Init ---

  buildPermTable(state.seed);
  syncOutputs();
  render();
})();
