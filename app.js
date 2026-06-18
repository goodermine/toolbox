/*
 * Image Metadata Cleaner — runs 100% in the browser.
 *
 * Default mode is LOSSLESS: we walk the file's container format and delete
 * only the metadata segments, leaving the compressed pixel data untouched.
 * "Deep clean" mode re-encodes via <canvas>, which guarantees removal of
 * anything unusual at the cost of re-compressing the image.
 */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const results = $("#results");
  const fileList = $("#fileList");
  const downloadAllBtn = $("#downloadAll");
  const clearAllBtn = $("#clearAll");
  const optKeepColor = $("#optKeepColor");
  const optReencode = $("#optReencode");

  /** @type {{name:string, blob:Blob}[]} */
  const cleaned = [];

  // ---------- UI wiring ----------

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = "";
  });

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
    cleaned.length = 0;
    fileList.innerHTML = "";
    results.hidden = true;
  });

  downloadAllBtn.addEventListener("click", async () => {
    if (cleaned.length === 0) return;
    if (cleaned.length === 1) { saveBlob(cleaned[0].blob, cleaned[0].name); return; }
    downloadAllBtn.disabled = true;
    try {
      const zip = await buildZip(cleaned);
      saveBlob(zip, "cleaned-images.zip");
    } finally {
      downloadAllBtn.disabled = false;
    }
  });

  // ---------- File handling ----------

  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(f.name));
    if (files.length === 0) return;
    results.hidden = false;

    for (const file of files) {
      const row = makeRow(file);
      fileList.appendChild(row.el);
      try {
        const result = await cleanFile(file);
        const outName = outputName(file.name, result.blob.type);
        cleaned.push({ name: outName, blob: result.blob });
        row.markDone(result, outName);
      } catch (err) {
        console.error(err);
        row.markError(err);
      }
    }
  }

  function outputName(name, mime) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    let ext = dot > 0 ? name.slice(dot) : "";
    if (mime === "image/png") ext = ".png";
    else if (mime === "image/jpeg") ext = ".jpg";
    else if (mime === "image/webp") ext = ".webp";
    return `${base}-clean${ext}`;
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
      <div class="file-meta">${formatBytes(file.size)} · <span class="working">cleaning…</span></div>`;

    const actions = document.createElement("div");
    actions.className = "file-actions";
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    actions.appendChild(spinner);

    el.append(img, info, actions);

    return {
      el,
      markDone(result, outName) {
        const meta = info.querySelector(".file-meta");
        const removedTxt = result.removed.length
          ? `<span class="removed">Removed: ${result.removed.join(", ")}</span>`
          : `<span class="none">No metadata found</span>`;
        meta.innerHTML = `${formatBytes(result.blob.size)} · ${removedTxt}` +
          `<span class="badge">${result.mode}</span>`;
        actions.innerHTML = "";
        const dl = document.createElement("button");
        dl.className = "btn btn-primary";
        dl.textContent = "⬇ Download";
        dl.addEventListener("click", () => saveBlob(result.blob, outName));
        actions.appendChild(dl);
      },
      markError(err) {
        const meta = info.querySelector(".file-meta");
        meta.innerHTML = `<span class="err">Could not process: ${escapeHtml(err.message || String(err))}</span>`;
        actions.innerHTML = "";
      },
    };
  }

  // ---------- Cleaning dispatcher ----------

  async function cleanFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const reencode = optReencode.checked;
    const keepColor = optKeepColor.checked;

    if (!reencode) {
      try {
        if (isJpeg(buf)) return wrap(stripJpeg(buf, keepColor), "lossless");
        if (isPng(buf)) return wrap(stripPng(buf, keepColor), "lossless");
        if (isWebp(buf)) return wrap(stripWebp(buf), "lossless");
      } catch (e) {
        // fall through to canvas re-encode if surgical strip fails
        console.warn("Lossless strip failed, falling back to re-encode:", e);
      }
    }
    // Deep clean / fallback: re-encode via canvas (drops all metadata).
    const blob = await reencodeViaCanvas(file, buf);
    return { blob, removed: ["all metadata (re-encoded)"], mode: "deep clean" };
  }

  function wrap(res, mode) {
    return { blob: res.blob, removed: res.removed, mode };
  }

  // ---------- Format detection ----------

  function isJpeg(b) { return b.length > 3 && b[0] === 0xff && b[1] === 0xd8; }
  function isPng(b) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return b.length > 8 && sig.every((v, i) => b[i] === v);
  }
  function isWebp(b) {
    return b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; // WEBP
  }

  // ---------- JPEG ----------
  // Remove APPn (EXIF/XMP/ICC*/JUMBF-C2PA/...) and COM segments.
  function stripJpeg(buf, keepColor) {
    const out = [];
    const removed = new Set();
    out.push(0xff, 0xd8); // SOI
    let i = 2;

    while (i < buf.length) {
      if (buf[i] !== 0xff) { // resync to next marker
        i++; continue;
      }
      // skip fill bytes
      let marker = buf[i + 1];
      while (marker === 0xff && i + 1 < buf.length) { i++; marker = buf[i + 1]; }

      if (marker === 0xd9) { out.push(0xff, 0xd9); break; } // EOI
      if (marker === 0xda) { // SOS: copy rest of file (entropy-coded data)
        for (let k = i; k < buf.length; k++) out.push(buf[k]);
        break;
      }
      // Standalone markers (no length): RSTn, TEM
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        out.push(0xff, marker); i += 2; continue;
      }

      const len = (buf[i + 2] << 8) | buf[i + 3];
      const segStart = i;
      const segEnd = i + 2 + len;

      const isApp = marker >= 0xe0 && marker <= 0xef;
      const isCom = marker === 0xfe;
      const isApp0Jfif = marker === 0xe0;
      const isApp2Icc = marker === 0xe2 &&
        matchAscii(buf, i + 4, "ICC_PROFILE");

      let drop = false;
      if (isCom) { drop = true; removed.add("JPEG comment"); }
      else if (isApp) {
        if (isApp0Jfif) drop = false; // JFIF header — keep (structural)
        else if (isApp2Icc && keepColor) drop = false; // keep ICC color profile
        else {
          drop = true;
          removed.add(appLabel(buf, i, marker));
        }
      }

      if (!drop) for (let k = segStart; k < segEnd; k++) out.push(buf[k]);
      i = segEnd;
    }

    return { blob: new Blob([new Uint8Array(out)], { type: "image/jpeg" }), removed: [...removed] };
  }

  function appLabel(buf, i, marker) {
    if (matchAscii(buf, i + 4, "Exif")) return "EXIF";
    if (matchAscii(buf, i + 4, "http://ns.adobe.com/xap")) return "XMP";
    if (matchAscii(buf, i + 4, "http://ns.adobe.com/xmp/extension")) return "XMP";
    if (matchAscii(buf, i + 4, "ICC_PROFILE")) return "ICC color profile";
    if (matchAscii(buf, i + 4, "Photoshop")) return "IPTC/Photoshop";
    if (marker === 0xeb || matchAscii(buf, i + 4, "JP")) return "C2PA/JUMBF";
    if (marker === 0xee) return "Adobe (APP14)";
    return `APP${marker - 0xe0}`;
  }

  // ---------- PNG ----------
  // Keep structural/color chunks; drop textual & metadata chunks.
  function stripPng(buf, keepColor) {
    const META = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "dSIG", "iDOT"]);
    const COLOR = new Set(["iCCP", "sRGB", "gAMA", "cHRM"]);
    const out = [];
    const removed = new Set();
    for (let k = 0; k < 8; k++) out.push(buf[k]); // signature
    let i = 8;

    while (i + 8 <= buf.length) {
      const len = (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
      const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
      const chunkEnd = i + 12 + len; // length(4)+type(4)+data(len)+crc(4)
      if (chunkEnd > buf.length) break;

      let drop = false;
      if (META.has(type)) { drop = true; removed.add(prettyPngType(type)); }
      else if (COLOR.has(type) && !keepColor) { drop = true; removed.add(`${type} color`); }

      if (!drop) for (let k = i; k < chunkEnd; k++) out.push(buf[k]);
      i = chunkEnd;
      if (type === "IEND") break;
    }

    return { blob: new Blob([new Uint8Array(out)], { type: "image/png" }), removed: [...removed] };
  }

  function prettyPngType(t) {
    if (t === "tEXt" || t === "zTXt" || t === "iTXt") return "text/AI params";
    if (t === "eXIf") return "EXIF";
    if (t === "tIME") return "timestamp";
    return t;
  }

  // ---------- WebP ----------
  // Drop EXIF / XMP chunks and clear the VP8X flags that advertise them.
  function stripWebp(buf) {
    const out = [];
    const removed = new Set();
    // RIFF header (12 bytes); we rewrite the size at the end.
    for (let k = 0; k < 12; k++) out.push(buf[k]);
    let i = 12;

    while (i + 8 <= buf.length) {
      const fourcc = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const size = (buf[i + 4] | buf[i + 5] << 8 | buf[i + 6] << 16 | buf[i + 7] << 24) >>> 0;
      const padded = size + (size & 1); // chunks are even-padded
      const chunkEnd = i + 8 + padded;
      if (chunkEnd > buf.length) break;

      if (fourcc === "EXIF" || fourcc === "XMP ") {
        removed.add(fourcc.trim());
      } else {
        for (let k = i; k < chunkEnd; k++) {
          let byte = buf[k];
          // Clear EXIF(bit3)/XMP(bit2) flags in the VP8X feature byte.
          if (fourcc === "VP8X" && k === i + 8) byte &= ~0b00001100;
          out.push(byte);
        }
      }
      i = chunkEnd;
    }

    // Fix RIFF chunk size = total - 8.
    const riffSize = out.length - 8;
    out[4] = riffSize & 0xff;
    out[5] = (riffSize >> 8) & 0xff;
    out[6] = (riffSize >> 16) & 0xff;
    out[7] = (riffSize >> 24) & 0xff;

    return { blob: new Blob([new Uint8Array(out)], { type: "image/webp" }), removed: [...removed] };
  }

  // ---------- Canvas re-encode (deep clean / fallback) ----------

  async function reencodeViaCanvas(file, buf) {
    const bmpType = isPng(buf) || isWebp(buf) ? "image/png" : "image/jpeg";
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([buf], { type: file.type || bmpType }));
    } catch {
      bitmap = await loadViaImg(file);
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();

    const outType = bmpType;
    const quality = outType === "image/jpeg" ? 0.95 : undefined;
    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), outType, quality)
    );
    return blob;
  }

  function loadViaImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("unsupported image")); };
      img.src = url;
    });
  }

  // ---------- Helpers ----------

  function matchAscii(buf, off, str) {
    if (off + str.length > buf.length) return false;
    for (let k = 0; k < str.length; k++) if (buf[off + k] !== str.charCodeAt(k)) return false;
    return true;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Minimal ZIP writer (store, no compression) ----------

  async function buildZip(items) {
    const crcTable = makeCrcTable();
    const fileParts = [];
    const central = [];
    let offset = 0;
    const encoder = new TextEncoder();
    const usedNames = new Set();

    for (const item of items) {
      let name = item.name;
      // de-dupe names within the zip
      let n = 1;
      while (usedNames.has(name)) {
        const dot = item.name.lastIndexOf(".");
        name = dot > 0 ? `${item.name.slice(0, dot)}(${n})${item.name.slice(dot)}` : `${item.name}(${n})`;
        n++;
      }
      usedNames.add(name);

      const data = new Uint8Array(await item.blob.arrayBuffer());
      const nameBytes = encoder.encode(name);
      const crc = crc32(data, crcTable);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); // local file header sig
      lv.setUint16(4, 20, true);         // version needed
      lv.setUint16(6, 0, true);          // flags
      lv.setUint16(8, 0, true);          // method = store
      lv.setUint16(10, 0, true);         // mod time
      lv.setUint16(12, 0, true);         // mod date
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      fileParts.push(local, data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); // central dir sig
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);    // local header offset
      cen.set(nameBytes, 46);
      central.push(cen);

      offset += local.length + data.length;
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, items.length, true);
    ev.setUint16(10, items.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...fileParts, ...central, end], { type: "application/zip" });
  }

  function makeCrcTable() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  }

  function crc32(data, table) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
})();
