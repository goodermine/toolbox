/*
 * HEIC/HEIF → JPG/PNG converter — 100% in the browser.
 * Uses heic2any (MIT, bundles libheif WASM), lazy-loaded on first use.
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

  // Quality only applies to JPG.
  function syncQuality() {
    qualityGroup.style.visibility = currentFmt() === "jpeg" ? "visible" : "hidden";
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
      saveBlob(await buildZip(done), "converted-images.zip");
    } finally {
      downloadAllBtn.disabled = false;
    }
  });

  // ---------- heic2any (lazy-loaded) ----------
  let libPromise = null;
  function ensureLib() {
    if (!libPromise) {
      libPromise = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "../vendor/heic2any.min.js";
        s.onload = () => (window.heic2any ? res() : rej(new Error("heic2any failed to load")));
        s.onerror = () => rej(new Error("could not load the converter"));
        document.head.appendChild(s);
      }).catch((e) => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  // ---------- File handling ----------
  function looksHeic(file) {
    return /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
  }

  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(looksHeic);
    const skipped = fileListLike.length - files.length;
    if (files.length === 0) {
      if (skipped > 0) alert("Please choose HEIC or HEIF files (the kind iPhones take).");
      return;
    }
    results.hidden = false;
    const fmt = currentFmt();
    const q = +quality.value / 100;

    for (const file of files) {
      const row = makeRow(file);
      fileList.appendChild(row.el);
      try {
        await ensureLib();
        const out = await window.heic2any({
          blob: file,
          toType: fmt === "png" ? "image/png" : "image/jpeg",
          quality: q,
        });
        // heic2any returns a Blob, or an array of Blobs for multi-image HEIC.
        const blob = Array.isArray(out) ? out[0] : out;
        const outName = outputName(file.name, fmt);
        done.push({ name: outName, blob });
        row.markDone(blob, file.size, outName);
      } catch (err) {
        console.error(err);
        row.markError(err);
      }
    }
  }

  function outputName(name, fmt) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base}.${fmt === "png" ? "png" : "jpg"}`;
  }

  // ---------- Row rendering ----------
  function makeRow(file) {
    const el = document.createElement("li");
    el.className = "file-item";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.display = "flex";
    thumb.style.alignItems = "center";
    thumb.style.justifyContent = "center";
    thumb.style.fontSize = "11px";
    thumb.style.color = "var(--text-dim)";
    thumb.textContent = "HEIC";

    const info = document.createElement("div");
    info.className = "file-info";
    info.innerHTML = `<div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-meta">${formatBytes(file.size)} · <span class="working">converting…</span></div>`;

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    actions.appendChild(spinner);

    el.append(thumb, info, actions);
    const meta = info.querySelector(".file-meta");

    return {
      el,
      markDone(blob, origSize, outName) {
        const url = URL.createObjectURL(blob);
        const img = document.createElement("img");
        img.className = "thumb";
        img.alt = "";
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        thumb.replaceWith(img);

        meta.innerHTML = `${formatBytes(origSize)} → ${formatBytes(blob.size)}` +
          `<span class="badge">${outName.endsWith(".png") ? "PNG" : "JPG"}</span>`;
        actions.innerHTML = "";
        const dl = document.createElement("button");
        dl.className = "btn btn-primary";
        dl.textContent = "⬇ Download";
        dl.addEventListener("click", () => saveBlob(blob, outName));
        actions.appendChild(dl);
      },
      markError(err) {
        meta.innerHTML = `<span class="err">Could not convert: ${escapeHtml(err.message || String(err))}</span>`;
        actions.innerHTML = "";
      },
    };
  }
})();
