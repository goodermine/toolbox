/*
 * Compress & convert images — 100% in the browser.
 * Uses browser-image-compression (MIT), lazy-loaded on first use.
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
  const quality = $("#quality");
  const qualityVal = $("#qualityVal");
  const qualityGroup = $("#qualityGroup");
  const maxDim = $("#maxDim");

  /** @type {{name:string, blob:Blob}[]} */
  const done = [];

  const currentFmt = () => document.querySelector('input[name="fmt"]:checked').value;

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

  // Quality is meaningless for PNG (lossless).
  function syncQuality() {
    qualityGroup.style.visibility = currentFmt() === "png" ? "hidden" : "visible";
  }
  document.querySelectorAll('input[name="fmt"]').forEach((r) => r.addEventListener("change", syncQuality));
  quality.addEventListener("input", () => { qualityVal.textContent = quality.value + "%"; });
  syncQuality();

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
      saveBlob(await buildZip(done), "compressed-images.zip");
    } finally {
      downloadAllBtn.disabled = false;
    }
  });

  // ---------- library (lazy-loaded) ----------
  let libPromise = null;
  function ensureLib() {
    if (!libPromise) {
      libPromise = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "../vendor/browser-image-compression.js";
        s.onload = () => (window.imageCompression ? res() : rej(new Error("compressor failed to load")));
        s.onerror = () => rej(new Error("could not load the compressor"));
        document.head.appendChild(s);
      }).catch((e) => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  const FMT_TYPE = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

  // ---------- File handling ----------
  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)
    );
    if (files.length === 0) return;
    results.hidden = false;

    const fmt = currentFmt();
    const q = +quality.value / 100;
    const dim = +maxDim.value;

    for (const file of files) {
      const row = makeRow(file);
      fileList.appendChild(row.el);
      try {
        await ensureLib();
        const options = {
          useWebWorker: true,
          initialQuality: q,
          maxSizeMB: 100, // effectively no size target — we drive quality + dimensions
        };
        if (fmt !== "keep") options.fileType = FMT_TYPE[fmt];
        if (dim > 0) options.maxWidthOrHeight = dim;

        const out = await window.imageCompression(file, options);
        const outName = outputName(file.name, out.type || file.type);
        done.push({ name: outName, blob: out });
        row.markDone(out, file.size, outName);
      } catch (err) {
        console.error(err);
        row.markError(err);
      }
    }
  }

  function extFor(type, fallbackName) {
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("jpeg")) return "jpg";
    const e = (fallbackName.split(".").pop() || "img").toLowerCase();
    return e === fallbackName.toLowerCase() ? "img" : e;
  }

  function outputName(origName, outType) {
    const dot = origName.lastIndexOf(".");
    const base = dot > 0 ? origName.slice(0, dot) : origName;
    return `${base}.${extFor(outType, origName)}`;
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
      <div class="file-meta">${formatBytes(file.size)} · <span class="working">compressing…</span></div>`;

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    actions.appendChild(spinner);

    el.append(img, info, actions);
    const meta = info.querySelector(".file-meta");

    return {
      el,
      markDone(blob, origSize, outName) {
        const pct = origSize > 0 ? Math.round((1 - blob.size / origSize) * 100) : 0;
        const change = pct >= 0
          ? `<span class="save">−${pct}%</span>`
          : `<span class="grow">+${-pct}%</span>`;
        const ext = outName.split(".").pop().toUpperCase();
        meta.innerHTML = `${formatBytes(origSize)} → ${formatBytes(blob.size)} ${change}` +
          `<span class="badge">${ext}</span>`;
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
})();
