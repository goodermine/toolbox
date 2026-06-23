/*
 * Image metadata viewer — reads EXIF / GPS / XMP / IPTC in the browser.
 * Uses exifr (MIT), lazy-loaded on first use.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const { formatBytes, escapeHtml } = window.ImgUtil;

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const results = $("#results");
  const cards = $("#cards");
  const clearAllBtn = $("#clearAll");

  // Keys worth calling out as privacy-sensitive.
  const SENSITIVE = /^(gps|latitude|longitude|make|model|serial|lensmodel|lensmake|owner|artist|hostcomputer|software|datetime)/i;

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
    cards.innerHTML = "";
    results.hidden = true;
  });

  // ---------- library (lazy-loaded) ----------
  let libPromise = null;
  function ensureLib() {
    if (!libPromise) {
      libPromise = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "../vendor/exifr.umd.js";
        s.onload = () => (window.exifr ? res() : rej(new Error("exifr failed to load")));
        s.onerror = () => rej(new Error("could not load the metadata reader"));
        document.head.appendChild(s);
      }).catch((e) => { libPromise = null; throw e; });
    }
    return libPromise;
  }

  // ---------- File handling ----------
  async function handleFiles(fileListLike) {
    const files = Array.from(fileListLike).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|tiff?|avif)$/i.test(f.name)
    );
    if (files.length === 0) return;
    results.hidden = false;

    for (const file of files) {
      const card = makeCard(file);
      cards.appendChild(card.el);
      try {
        await ensureLib();
        const data = await window.exifr.parse(file, {
          tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: true, jfif: true, ihdr: true,
          mergeOutput: true, translateValues: true, reviveValues: true,
        }).catch(() => null);
        let gps = null;
        try { gps = await window.exifr.gps(file); } catch { /* ignore */ }
        card.render(data, gps);
      } catch (err) {
        console.error(err);
        card.error(err);
      }
    }
  }

  function fmtValue(v) {
    if (v == null) return "";
    if (v instanceof Date) return v.toLocaleString();
    if (Array.isArray(v)) return v.map(fmtValue).join(", ");
    if (typeof v === "object") return escapeHtml(JSON.stringify(v));
    let s = String(v);
    if (s.length > 220) s = s.slice(0, 220) + "…";
    return escapeHtml(s);
  }

  // ---------- Card rendering ----------
  function makeCard(file) {
    const el = document.createElement("div");
    el.className = "meta-card";

    const head = document.createElement("div");
    head.className = "meta-head";
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    const title = document.createElement("div");
    title.className = "file-info";
    title.innerHTML = `<div class="file-name">${escapeHtml(file.name)}</div>
      <div class="file-meta">${formatBytes(file.size)} · <span class="working">reading…</span></div>`;
    head.append(img, title);

    const body = document.createElement("div");
    body.className = "meta-body";

    el.append(head, body);
    const metaLine = title.querySelector(".file-meta");

    return {
      el,
      render(data, gps) {
        const entries = data ? Object.entries(data).filter(([, v]) => v != null && v !== "") : [];
        if (entries.length === 0 && !gps) {
          metaLine.innerHTML = `${formatBytes(file.size)} · <span class="save">No metadata found 🎉</span>`;
          return;
        }
        metaLine.innerHTML = `${formatBytes(file.size)} · <span class="removed">${entries.length} field${entries.length === 1 ? "" : "s"}</span>`;

        let html = "";
        if (gps && gps.latitude != null && gps.longitude != null) {
          const lat = gps.latitude.toFixed(6), lon = gps.longitude.toFixed(6);
          html += `<div class="gps-banner">📍 <strong>Location found:</strong> ${lat}, ${lon}
            <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}" target="_blank" rel="noopener">view map ↗</a></div>`;
        }
        html += '<dl class="meta-list">';
        for (const [k, v] of entries) {
          const sensitive = SENSITIVE.test(k);
          html += `<dt class="${sensitive ? "sensitive" : ""}">${escapeHtml(k)}</dt><dd>${fmtValue(v)}</dd>`;
        }
        html += "</dl>";
        body.innerHTML = html;
      },
      error(err) {
        metaLine.innerHTML = `<span class="err">Could not read: ${escapeHtml(err.message || String(err))}</span>`;
      },
    };
  }
})();
