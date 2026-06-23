/*
 * AI background remover — 100% in the browser.
 * U²-Net (u2netp, Apache-2.0) run via ONNX Runtime Web (MIT). Both vendored
 * locally and lazy-loaded on first use, so it's private and works offline.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const { saveBlob, buildZip, formatBytes, escapeHtml } = window.ImgUtil;

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const results = $("#results");
  const fileList = $("#fileList");
  const downloadAllBtn = $("#downloadAll");
  const clearAllBtn = $("#clearAll");

  const MODEL_SIZE = 320;       // U²-Net input resolution
  const MAX_OUT_DIM = 2048;     // cap output to keep memory sane on phones
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  /** @type {{name:string, blob:Blob}[]} */
  const done = [];

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

  clearAllBtn.addEventListener("click", () => {
    done.length = 0;
    fileList.innerHTML = "";
    results.hidden = true;
  });

  downloadAllBtn.addEventListener("click", async () => {
    if (done.length === 0) return;
    if (done.length === 1) { saveBlob(done[0].blob, done[0].name); return; }
    downloadAllBtn.disabled = true;
    try {
      saveBlob(await buildZip(done), "no-background.zip");
    } finally {
      downloadAllBtn.disabled = false;
    }
  });

  // ---------- Engine (lazy-loaded) ----------
  let sessionPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => res();
      s.onerror = () => rej(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }

  function ensureSession() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        await loadScript("../vendor/ort.wasm.min.js");
        if (!window.ort) throw new Error("ONNX Runtime failed to load");
        // GitHub Pages isn't cross-origin isolated, so keep it single-threaded.
        window.ort.env.wasm.wasmPaths = "../vendor/";
        window.ort.env.wasm.numThreads = 1;
        return window.ort.InferenceSession.create("../vendor/models/u2netp/u2netp.onnx", {
          executionProviders: ["wasm"],
        });
      })().catch((e) => { sessionPromise = null; throw e; });
    }
    return sessionPromise;
  }

  // ---------- File handling ----------
  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)
    );
    if (files.length === 0) return;
    results.hidden = false;

    for (const file of files) {
      const row = makeRow(file);
      fileList.appendChild(row.el);
      let url;
      try {
        row.note("⏳ Loading AI model (one-time)…");
        const session = await ensureSession();
        const loaded = await loadImage(file);
        url = loaded.url;
        row.note("removing background…");
        const blob = await removeBackground(session, loaded.img);
        const outName = outputName(file.name);
        done.push({ name: outName, blob });
        row.markDone(blob, outName);
      } catch (err) {
        console.error(err);
        row.markError(err);
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
  }

  function outputName(name) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base}-no-bg.png`;
  }

  // ---------- Inference ----------
  async function removeBackground(session, img) {
    // Output size (capped for memory safety).
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, MAX_OUT_DIM / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    // 1) Preprocess: draw to 320x320 and build a normalized NCHW tensor.
    const inCanvas = document.createElement("canvas");
    inCanvas.width = MODEL_SIZE; inCanvas.height = MODEL_SIZE;
    const ictx = inCanvas.getContext("2d");
    ictx.drawImage(img, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const px = ictx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;

    const n = MODEL_SIZE * MODEL_SIZE;
    const data = new Float32Array(3 * n);
    for (let p = 0; p < n; p++) {
      const r = px[p * 4] / 255, g = px[p * 4 + 1] / 255, b = px[p * 4 + 2] / 255;
      data[p] = (r - MEAN[0]) / STD[0];                 // R plane
      data[n + p] = (g - MEAN[1]) / STD[1];             // G plane
      data[2 * n + p] = (b - MEAN[2]) / STD[2];         // B plane
    }

    const tensor = new window.ort.Tensor("float32", data, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const feeds = {}; feeds[session.inputNames[0]] = tensor;
    const out = await session.run(feeds);
    const mask = out[session.outputNames[0]].data; // [1,1,320,320]

    // 2) Normalize mask to 0..1.
    let mi = Infinity, ma = -Infinity;
    for (let i = 0; i < mask.length; i++) { if (mask[i] < mi) mi = mask[i]; if (mask[i] > ma) ma = mask[i]; }
    const range = ma - mi || 1;

    // 3) Put mask into a 320x320 canvas (as alpha), then scale to output size.
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = MODEL_SIZE; maskCanvas.height = MODEL_SIZE;
    const mctx = maskCanvas.getContext("2d");
    const mImg = mctx.createImageData(MODEL_SIZE, MODEL_SIZE);
    for (let i = 0; i < n; i++) {
      const v = Math.round(((mask[i] - mi) / range) * 255);
      mImg.data[i * 4] = mImg.data[i * 4 + 1] = mImg.data[i * 4 + 2] = v;
      mImg.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(mImg, 0, 0);

    const scaledMask = document.createElement("canvas");
    scaledMask.width = w; scaledMask.height = h;
    const smctx = scaledMask.getContext("2d");
    smctx.imageSmoothingEnabled = true;
    smctx.imageSmoothingQuality = "high";
    smctx.drawImage(maskCanvas, 0, 0, w, h);
    const maskData = smctx.getImageData(0, 0, w, h).data;

    // 4) Composite: original RGB with mask as alpha.
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w; outCanvas.height = h;
    const octx = outCanvas.getContext("2d");
    octx.drawImage(img, 0, 0, w, h);
    const outData = octx.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) {
      outData.data[i * 4 + 3] = maskData[i * 4]; // mask grayscale -> alpha
    }
    octx.putImageData(outData, 0, 0);

    return new Promise((res, rej) =>
      outCanvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png")
    );
  }

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
    info.innerHTML = `<div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-meta"><span class="working">queued…</span></div>`;

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    actions.appendChild(spinner);

    el.append(img, info, actions);
    const meta = info.querySelector(".file-meta");

    return {
      el,
      note(text) { meta.innerHTML = `<span class="working">${escapeHtml(text)}</span>`; },
      markDone(blob, outName) {
        meta.innerHTML = `Background removed · ${formatBytes(blob.size)}<span class="badge">PNG</span>`;
        actions.innerHTML = "";
        const dl = document.createElement("button");
        dl.className = "btn btn-primary";
        dl.textContent = "⬇ Download";
        dl.addEventListener("click", () => saveBlob(blob, outName));
        actions.appendChild(dl);
      },
      markError(err) {
        meta.innerHTML = `<span class="err">Could not process: ${escapeHtml(err.message || String(err))}</span>`;
        actions.innerHTML = "";
      },
    };
  }

  // Exposed for tests.
  window.BgRemove = { ensureSession, removeBackground };
})();
