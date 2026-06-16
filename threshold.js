(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const histCanvas = document.getElementById("histogram");
  const histCtx = histCanvas.getContext("2d");

  const els = {
    imageFile: document.getElementById("image-file"),
    threshold: document.getElementById("threshold"),
    thresholdValue: document.getElementById("threshold-value"),
    auto: document.getElementById("auto"),
    invert: document.getElementById("invert"),
    transparent: document.getElementById("transparent"),
    export: document.getElementById("export"),
    emptyState: document.getElementById("empty-state"),
    dimensions: document.getElementById("canvas-dimensions"),
    viewport: document.getElementById("canvas-viewport"),
  };

  // Cap the working resolution so per-pixel thresholding stays responsive
  const MAX_DIM = 1600;

  const state = {
    threshold: 128,
    invert: false,
    transparent: false,
  };

  let W = 0;
  let H = 0;
  // Per-pixel luminance of the loaded image at working resolution
  let gray = null;
  // 256-bin luminance histogram, used for the strip and for Otsu
  let histogram = null;

  // --- Image loading ---

  // Draws the image at a resolution capped to MAX_DIM, then extracts the
  // grayscale luminance map and its histogram. No cropping: the canvas
  // takes the image's aspect ratio.
  function loadImage(img) {
    const s = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    W = canvas.width = Math.max(1, Math.round(img.width * s));
    H = canvas.height = Math.max(1, Math.round(img.height * s));

    const tmp = document.createElement("canvas");
    tmp.width = W;
    tmp.height = H;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(img, 0, 0, W, H);
    const data = tctx.getImageData(0, 0, W, H).data;

    gray = new Uint8ClampedArray(W * H);
    histogram = new Uint32Array(256);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(
        0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
      );
      gray[i] = v;
      histogram[v]++;
    }

    canvas.hidden = false;
    els.emptyState.hidden = true;
    els.dimensions.textContent = `${img.width} x ${img.height}` +
      (s < 1 ? ` (working ${W} x ${H})` : "");
    [els.threshold, els.auto, els.export].forEach((el) => (el.disabled = false));
  }

  // --- Otsu's method: pick the threshold that maximizes between-class variance ---

  function otsuThreshold() {
    const total = W * H;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];

    let sumB = 0;
    let wB = 0;
    let maxVar = -1;
    // For perfectly separable images the variance is flat across the gap
    // between modes, so we track the whole maximizing range and return its
    // midpoint rather than landing on a mode.
    let tFirst = 128;
    let tLast = 128;
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        tFirst = tLast = t;
      } else if (between === maxVar) {
        tLast = t;
      }
    }
    return Math.round((tFirst + tLast) / 2);
  }

  // --- Rendering ---

  function renderMask() {
    if (!gray) return;
    const image = ctx.createImageData(W, H);
    const data = image.data;
    const t = state.threshold;
    const transparent = state.transparent;
    for (let i = 0; i < W * H; i++) {
      // Pixels at or above the threshold are foreground (white) by default
      let on = gray[i] >= t;
      if (state.invert) on = !on;
      const c = on ? 255 : 0;
      data[i * 4] = c;
      data[i * 4 + 1] = c;
      data[i * 4 + 2] = c;
      // As an alpha matte: foreground opaque white, background fully transparent
      data[i * 4 + 3] = transparent ? (on ? 255 : 0) : 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function renderHistogram() {
    const w = histCanvas.width;
    const h = histCanvas.height;
    histCtx.clearRect(0, 0, w, h);
    if (!histogram) return;

    let max = 0;
    for (let i = 0; i < 256; i++) if (histogram[i] > max) max = histogram[i];
    if (max === 0) return;

    // Log scale keeps small bins visible next to tall spikes
    const norm = (v) => Math.log(1 + v) / Math.log(1 + max);
    histCtx.fillStyle = "#3a4150";
    for (let i = 0; i < 256; i++) {
      const x = (i / 256) * w;
      const barH = norm(histogram[i]) * (h - 2);
      histCtx.fillRect(x, h - barH, w / 256 + 0.5, barH);
    }

    // Threshold marker
    const tx = (state.threshold / 255) * w;
    histCtx.fillStyle = "#7da7ff";
    histCtx.fillRect(tx - 1, 0, 2, h);
  }

  function render() {
    renderMask();
    renderHistogram();
  }

  // --- Controls ---

  els.imageFile.addEventListener("change", () => {
    const file = els.imageFile.files && els.imageFile.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      loadImage(img);
      render();
    };
    img.src = url;
  });

  els.threshold.addEventListener("input", () => {
    state.threshold = Number(els.threshold.value);
    els.thresholdValue.textContent = state.threshold;
    render();
  });

  els.auto.addEventListener("click", () => {
    state.threshold = otsuThreshold();
    els.threshold.value = state.threshold;
    els.thresholdValue.textContent = state.threshold;
    render();
  });

  els.invert.addEventListener("change", () => {
    state.invert = els.invert.checked;
    renderMask();
  });

  els.transparent.addEventListener("change", () => {
    state.transparent = els.transparent.checked;
    els.viewport.classList.toggle("transparent", state.transparent);
    renderMask();
  });

  els.export.addEventListener("click", () => {
    if (!gray) return;
    const link = document.createElement("a");
    link.download = "threshold-mask.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  // --- Init ---

  renderHistogram();
})();
