/*
 * Image upsizer — runs 100% in the browser.
 *
 * AI mode: ESRGAN super-resolution via TensorFlow.js + UpscalerJS, all
 * vendored locally (see /vendor) so nothing is fetched from a third-party
 * CDN and it works offline after first load. Fast mode: high-quality
 * canvas (bicubic) scaling — instant, zero dependencies, universal fallback.
 *
 * Also owns the Clean/Upsize tab switching.
 */

(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);

  // Device class matters a lot: iOS browsers (every iPhone/iPad browser, incl.
  // Chrome, runs on Safari/WebKit) have very strict per-tab memory limits and
  // crash the tab on big images. Android Chrome and desktops handle far more.
  const UA = navigator.userAgent;
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(UA)); // iPadOS reports as "Macintosh"
  const IS_ANDROID = /Android/.test(UA);
  const IS_MOBILE = IS_IOS || IS_ANDROID;

  // Per-device pixel budgets (output pixels):
  //  - maxDim/maxArea: hard canvas limit — beyond this the canvas can't exist.
  //  - aiBudget: above this, the AI model's tensors would exhaust memory.
  //  - fastBudget: above this, even plain canvas scaling risks crashing.
  function deviceLimits() {
    if (IS_IOS) return { maxDim: 4096, aiBudget: 5000000, fastBudget: 9000000 };
    if (IS_ANDROID) return { maxDim: 8192, aiBudget: 16777216, fastBudget: 67108864 };
    return { maxDim: 16384, aiBudget: 67108864, fastBudget: 268435456 };
  }

  // Decide how to handle a requested upscale given device limits:
  //  - "ai" / "fast": proceed with that engine.
  //  - "fast-fallback": too heavy for AI, but fine via plain canvas scaling.
  //  - "too-big": exceeds what this device can do at all — recommend a lower scale.
  function planUpscale(w, h, scale, mode, L) {
    const outW = w * scale, outH = h * scale, area = outW * outH;
    if (outW > L.maxDim || outH > L.maxDim || area > L.maxDim * L.maxDim) {
      return { action: "too-big", outW, outH };
    }
    if (mode === "ai" && area > L.aiBudget) {
      return area <= L.fastBudget
        ? { action: "fast-fallback", outW, outH }
        : { action: "too-big", outW, outH };
    }
    if (mode === "fast" && area > L.fastBudget) {
      return { action: "too-big", outW, outH };
    }
    return { action: mode === "ai" ? "ai" : "fast", outW, outH };
  }

  // ---------- Tabs ----------
  const TABS = [["tab-clean", "panel-clean"], ["tab-upsize", "panel-upsize"]];
  function activate(activeTab) {
    for (const [t, p] of TABS) {
      const on = t === activeTab;
      const tab = document.getElementById(t);
      const panel = document.getElementById(p);
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      panel.hidden = !on;
    }
  }
  for (const [t] of TABS) document.getElementById(t).addEventListener("click", () => activate(t));

  // ---------- Upsize elements ----------
  const dropzone = $("#dropzoneUp");
  const fileInput = $("#fileInputUp");
  const results = $("#resultsUp");
  const fileList = $("#fileListUp");
  const downloadAllBtn = $("#downloadAllUp");
  const clearAllBtn = $("#clearAllUp");
  const aiHint = $("#aiHint");

  /** @type {{name:string, blob:Blob}[]} */
  const done = [];

  const currentScale = () => +document.querySelector('input[name="scale"]:checked').value;
  const currentMode = () => document.querySelector('input[name="upmode"]:checked').value;

  // ---------- UI wiring ----------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => { handleFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  // Hide the "model downloads" hint when Fast mode is selected.
  document.querySelectorAll('input[name="upmode"]').forEach((r) =>
    r.addEventListener("change", () => {
      aiHint.style.visibility = currentMode() === "ai" ? "visible" : "hidden";
    })
  );

  // Warn iPhone/iPad users up front that 4× usually exceeds their memory limit.
  const scaleWarn = $("#scaleWarn");
  function updateScaleWarning() {
    if (scaleWarn) scaleWarn.hidden = !(IS_IOS && currentScale() === 4);
  }
  document.querySelectorAll('input[name="scale"]').forEach((r) =>
    r.addEventListener("change", updateScaleWarning)
  );
  updateScaleWarning();

  clearAllBtn.addEventListener("click", () => {
    done.length = 0;
    fileList.innerHTML = "";
    results.hidden = true;
  });

  downloadAllBtn.addEventListener("click", async () => {
    if (done.length === 0) return;
    if (done.length === 1) { window.ImgUtil.saveBlob(done[0].blob, done[0].name); return; }
    downloadAllBtn.disabled = true;
    try {
      const zip = await window.ImgUtil.buildZip(done);
      window.ImgUtil.saveBlob(zip, "upsized-images.zip");
    } finally {
      downloadAllBtn.disabled = false;
    }
  });

  // ---------- File handling (sequential — AI is GPU-heavy) ----------
  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)
    );
    if (files.length === 0) return;
    results.hidden = false;

    const scale = currentScale();
    const mode = currentMode();
    const limits = deviceLimits();

    for (const file of files) {
      const row = makeRow(file);
      fileList.appendChild(row.el);
      let url;
      try {
        const loaded = await loadImage(file);
        url = loaded.url;
        const img = loaded.img;

        const plan = planUpscale(img.naturalWidth, img.naturalHeight, scale, mode, limits);
        if (plan.action === "too-big") {
          row.markTooBig(scale, plan.outW, plan.outH);
          continue;
        }
        let useMode = mode;
        if (plan.action === "fast-fallback") {
          useMode = "fast";
          row.note("Large image — using Fast mode so it doesn't run out of memory on this device.");
        }

        let blob;
        if (useMode === "ai") {
          try {
            // First-ever AI use (or first time for this scale) loads the model — let the user know why it's slower.
            if (!engineLoaded || !upscalers[scale]) {
              row.note("⏳ Loading the AI model (one-time, ~3 MB)… this is the slow part — it's fast after this.");
            }
            blob = await aiUpscale(img, scale, row.setProgress);
          } catch (e) {
            console.warn("AI upscale failed, falling back to fast mode:", e);
            row.note("AI unavailable — used fast mode");
            blob = await fastUpscale(img, scale);
          }
        } else {
          blob = await fastUpscale(img, scale);
        }

        const outName = outputName(file.name, scale);
        done.push({ name: outName, blob });
        row.markDone(blob, scale, img.naturalWidth, img.naturalHeight, outName, useMode);
      } catch (err) {
        console.error(err);
        row.markError(err);
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
  }

  function outputName(name, scale) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base}-${scale}x.png`;
  }

  // ---------- AI engine (lazy-loaded) ----------
  let enginePromise = null;
  let engineLoaded = false;
  const upscalers = {};

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }

  function ensureEngine() {
    if (!enginePromise) {
      enginePromise = (async () => {
        await loadScript("vendor/tf.min.js");
        await loadScript("vendor/upscaler.min.js");
        if (window.tf && window.tf.ready) await window.tf.ready();
        if (!window.Upscaler) throw new Error("UpscalerJS failed to initialize");
        engineLoaded = true;
      })().catch((e) => { enginePromise = null; throw e; });
    }
    return enginePromise;
  }

  function getUpscaler(scale) {
    if (upscalers[scale]) return upscalers[scale];
    // A top-level `path` makes UpscalerJS load the model directly (no CDN).
    const model = {
      path: `vendor/models/esrgan-slim/x${scale}/model.json`,
      scale,
      modelType: "layers",
      meta: { architecture: "rdn" },
      inputRange: [0, 255],
      outputRange: [0, 255],
    };
    upscalers[scale] = new window.Upscaler({ model });
    return upscalers[scale];
  }

  async function aiUpscale(img, scale, onProgress) {
    await ensureEngine();
    const up = getUpscaler(scale);
    if (onProgress) onProgress(0);
    const src = await up.upscale(img, {
      output: "base64",
      // Tile the image so large inputs don't exhaust GPU memory; also drives progress.
      // Smaller tiles on mobile keep peak memory low.
      patchSize: IS_MOBILE ? 64 : 128,
      padding: IS_MOBILE ? 4 : 6,
      progress: (rate) => { if (onProgress) onProgress(rate); },
    });
    if (onProgress) onProgress(1);
    const rgbBlob = await dataUrlToBlob(src);
    // ESRGAN is RGB-only and returns an opaque image. If the source had
    // transparency (common for AI stickers/logos), reapply an upscaled alpha
    // channel so it isn't flattened to an opaque background.
    if (hasTransparency(img)) return compositeAlpha(rgbBlob, img);
    return rgbBlob;
  }

  async function dataUrlToBlob(dataUrl) {
    return (await fetch(dataUrl)).blob();
  }

  // True if any pixel in the source image is not fully opaque.
  function hasTransparency(img) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    let data;
    try {
      data = ctx.getImageData(0, 0, c.width, c.height).data;
    } catch {
      return false; // tainted canvas (shouldn't happen for local files)
    }
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  }

  // Replace the (opaque) alpha of the AI result with the source alpha,
  // bicubic-scaled to the AI output dimensions.
  async function compositeAlpha(rgbBlob, srcImg) {
    const rgbImg = await blobToImage(rgbBlob);
    const w = rgbImg.naturalWidth, h = rgbImg.naturalHeight;

    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const octx = out.getContext("2d");
    octx.drawImage(rgbImg, 0, 0);
    const outData = octx.getImageData(0, 0, w, h);

    const alpha = document.createElement("canvas");
    alpha.width = w; alpha.height = h;
    const actx = alpha.getContext("2d");
    actx.imageSmoothingEnabled = true;
    actx.imageSmoothingQuality = "high";
    actx.drawImage(srcImg, 0, 0, w, h);
    const aData = actx.getImageData(0, 0, w, h).data;

    for (let i = 3; i < outData.data.length; i += 4) outData.data[i] = aData[i];
    octx.putImageData(outData, 0, 0);

    URL.revokeObjectURL(rgbImg.src);
    return new Promise((res, rej) =>
      out.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
    );
  }

  function blobToImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode failed")); };
      img.src = url;
    });
  }

  // ---------- Fast (canvas bicubic) ----------
  function fastUpscale(img, scale) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
    );
  }

  // ---------- Helpers ----------
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("unsupported image")); };
      img.src = url;
    });
  }

  // ---------- Row rendering ----------
  function makeRow(file) {
    const el = document.createElement("li");
    el.className = "file-item";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    const objUrl = URL.createObjectURL(file);
    img.src = objUrl;
    img.onload = () => URL.revokeObjectURL(objUrl);

    const info = document.createElement("div");
    info.className = "file-info";
    info.innerHTML = `<div class="file-name">${window.ImgUtil.escapeHtml(file.name)}</div>
      <div class="file-meta"><span class="working">preparing…</span></div>
      <div class="progress" hidden><div class="bar"></div></div>`;

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    actions.appendChild(spinner);

    el.append(img, info, actions);

    const meta = info.querySelector(".file-meta");
    const progress = info.querySelector(".progress");
    const bar = info.querySelector(".bar");

    return {
      el,
      setProgress(rate) {
        progress.hidden = false;
        const pct = Math.round(rate * 100);
        bar.style.width = pct + "%";
        meta.querySelector(".working").textContent = `upscaling… ${pct}%`;
      },
      note(text) {
        meta.innerHTML = `<span class="working">${window.ImgUtil.escapeHtml(text)}</span>`;
      },
      markDone(blob, scale, w, h, outName, mode) {
        progress.hidden = true;
        const dims = `${w}×${h} → ${w * scale}×${h * scale}`;
        meta.innerHTML = `${dims} · ${window.ImgUtil.formatBytes(blob.size)}` +
          `<span class="badge">${mode === "ai" ? scale + "× AI" : scale + "× fast"}</span>`;
        actions.innerHTML = "";
        const dl = document.createElement("button");
        dl.className = "btn btn-primary";
        dl.textContent = "⬇ Download";
        dl.addEventListener("click", () => window.ImgUtil.saveBlob(blob, outName));
        actions.appendChild(dl);
      },
      markTooBig(scale, w, h) {
        progress.hidden = true;
        const advice = scale > 2
          ? "Unfortunately " + scale + "× is too memory-heavy for this browser — please use 2× instead (it works reliably here)."
          : "This image is too large for this browser — please try a smaller image.";
        meta.innerHTML = `<span class="err">${advice} <span class="dim">(${scale}× would be ${w}×${h}.)</span></span>`;
        actions.innerHTML = "";
      },
      markError(err) {
        progress.hidden = true;
        meta.innerHTML = `<span class="err">Could not process: ${window.ImgUtil.escapeHtml(err.message || String(err))}</span>`;
        actions.innerHTML = "";
      },
    };
  }

  // Exposed for tests.
  window.Upsize = { planUpscale, deviceLimits, IS_IOS, IS_ANDROID };
})();
