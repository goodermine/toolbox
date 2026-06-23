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

        // Read raw bytes once for things exifr doesn't surface:
        // PNG text chunks (where many AI tools store data) and AI/C2PA signatures.
        const buf = new Uint8Array(await file.arrayBuffer());
        const pngText = await parsePngText(buf).catch(() => []);
        const ai = detectAI(buf, data, pngText);

        card.render(data, gps, pngText, ai);
      } catch (err) {
        console.error(err);
        card.error(err);
      }
    }
  }

  // ---------- PNG text chunks (tEXt / zTXt / iTXt) ----------
  // exifr doesn't surface these, but it's where Stable Diffusion (parameters),
  // ComfyUI (prompt/workflow), and many tools store data.
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const latin1 = (buf, a, b) => {
    let s = "";
    for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]);
    return s;
  };

  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const ds = new DecompressionStream("deflate");
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    } catch { return null; }
  }

  async function parsePngText(buf) {
    if (buf.length < 8 || !PNG_SIG.every((v, i) => buf[i] === v)) return [];
    const out = [];
    let i = 8;
    while (i + 8 <= buf.length) {
      const len = (buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3]) >>> 0;
      const type = latin1(buf, i + 4, i + 8);
      const dataStart = i + 8, dataEnd = dataStart + len;
      if (dataEnd > buf.length) break;
      try {
        if (type === "tEXt") {
          const z = buf.indexOf(0, dataStart);
          out.push({ keyword: latin1(buf, dataStart, z), text: latin1(buf, z + 1, dataEnd) });
        } else if (type === "zTXt") {
          const z = buf.indexOf(0, dataStart);
          const text = await inflate(buf.subarray(z + 2, dataEnd));
          if (text != null) out.push({ keyword: latin1(buf, dataStart, z), text });
        } else if (type === "iTXt") {
          const z = buf.indexOf(0, dataStart);
          const compFlag = buf[z + 1];
          let p = buf.indexOf(0, z + 3); // after compression method, language tag
          p = buf.indexOf(0, p + 1);     // translated keyword
          const keyword = latin1(buf, dataStart, z);
          if (compFlag === 1) {
            const text = await inflate(buf.subarray(p + 1, dataEnd));
            if (text != null) out.push({ keyword, text });
          } else {
            out.push({ keyword, text: new TextDecoder().decode(buf.subarray(p + 1, dataEnd)) });
          }
        }
      } catch { /* skip malformed chunk */ }
      if (type === "IEND") break;
      i = dataEnd + 4; // skip CRC
    }
    return out;
  }

  // ---------- AI / provenance detection ----------
  const AI_TOOLS = [
    "gemini", "imagen", "google ai", "dall-e", "dall·e", "openai", "midjourney",
    "stable diffusion", "automatic1111", "comfyui", "invokeai", "adobe firefly",
    "firefly", "grok", "flux", "leonardo", "ideogram", "runway", "stability ai",
    "nano banana", "krea", "recraft", "bing image creator", "designer",
  ];

  function detectAI(buf, data, pngText) {
    const signals = [];
    // Whole-file text scan (catches C2PA manifests, XMP, embedded tool names).
    let hay = "";
    try { hay = new TextDecoder("latin1").decode(buf).toLowerCase(); } catch { hay = ""; }
    const pngBlob = pngText.map((t) => `${t.keyword} ${t.text}`).join(" ").toLowerCase();
    const metaBlob = data ? JSON.stringify(data).toLowerCase() : "";
    const all = hay + " " + pngBlob + " " + metaBlob;

    if (all.includes("c2pa") || all.includes("contentcredentials") || all.includes("content credentials"))
      signals.push("C2PA Content Credentials");
    if (all.includes("trainedalgorithmicmedia") || all.includes("digitalsourcetype"))
      signals.push("IPTC “AI-generated” source tag");
    if (/made with ai|ai[- ]generated|generated by ai|generative ai/.test(all))
      signals.push("“AI-generated” label");
    const found = AI_TOOLS.filter((t) => all.includes(t));
    if (found.length) signals.push("mentions " + found.map((t) => `“${t}”`).join(", "));

    // De-dupe
    return { isAI: signals.length > 0, signals: [...new Set(signals)] };
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
    // Revoke on both paths — many accepted formats (HEIC/TIFF/AVIF) can't be
    // rendered by <img>, so onload may never fire.
    img.onload = () => URL.revokeObjectURL(url);
    img.onerror = () => { URL.revokeObjectURL(url); img.style.visibility = "hidden"; };
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
      render(data, gps, pngText, ai) {
        const entries = data ? Object.entries(data).filter(([, v]) => v != null && v !== "") : [];
        const textEntries = (pngText || []).filter((t) => t.text && t.text.trim() !== "");
        const hasGps = !!(gps && gps.latitude != null && gps.longitude != null);
        ai = ai || { isAI: false, signals: [] };

        // Fields that are just image structure, not personal/identifying metadata.
        const STRUCTURAL = new Set(["ImageWidth", "ImageHeight", "BitDepth", "ColorType",
          "Compression", "Filter", "Interlace", "ColorComponents", "BitsPerSample",
          "JFIFVersion", "ResolutionUnit", "XResolution", "YResolution", "ColorSpace"]);
        const meaningful = entries.filter(([k]) => !STRUCTURAL.has(k));

        const nothing = !entries.length && !textEntries.length && !hasGps && !ai.isAI;
        if (nothing) {
          metaLine.innerHTML = `${formatBytes(file.size)} · <span class="save">No metadata found 🎉</span>`;
          body.innerHTML = `<p class="meta-note">No EXIF, GPS, text, or AI-provenance data. <em>Note: some AI generators (e.g. Google's Gemini/Imagen) add an invisible <strong>SynthID</strong> watermark in the pixels — no metadata viewer can read that.</em></p>`;
          return;
        }

        const parts = [];
        if (ai.isAI) parts.push("AI-generated?");
        if (meaningful.length) parts.push(`${entries.length} field${entries.length === 1 ? "" : "s"}`);
        else if (entries.length) parts.push("basic image info");
        if (textEntries.length) parts.push(`${textEntries.length} text chunk${textEntries.length === 1 ? "" : "s"}`);
        if (hasGps) parts.push("GPS location");
        const cls = ai.isAI || hasGps ? "removed" : "save";
        metaLine.innerHTML = `${formatBytes(file.size)} · <span class="${cls}">${parts.join(" · ")}</span>`;

        let html = "";
        if (ai.isAI) {
          html += `<div class="ai-banner">🤖 <strong>Likely AI-generated.</strong> Found: ${escapeHtml(ai.signals.join("; "))}.</div>`;
        }
        if (hasGps) {
          const lat = gps.latitude.toFixed(6), lon = gps.longitude.toFixed(6);
          html += `<div class="gps-banner">📍 <strong>Location found:</strong> ${lat}, ${lon}
            <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}" target="_blank" rel="noopener">view map ↗</a></div>`;
        }

        const fields = entries.map(([k, v]) => [k, fmtValue(v)])
          .concat(textEntries.map((t) => [`text: ${t.keyword || "(text)"}`, fmtValue(t.text)]));
        if (fields.length) {
          html += '<dl class="meta-list">';
          for (const [k, v] of fields) {
            const sensitive = SENSITIVE.test(k) || /^text:/.test(k);
            html += `<dt class="${sensitive ? "sensitive" : ""}">${escapeHtml(k)}</dt><dd>${v}</dd>`;
          }
          html += "</dl>";
        }

        if (!meaningful.length && !textEntries.length && !hasGps) {
          html += `<p class="meta-note">Only basic image-structure fields — no camera, GPS, or personal metadata.</p>`;
        }
        if (!ai.isAI) {
          html += `<p class="meta-note">No AI-provenance metadata detected. <em>Note: AI tools like Google's Gemini/Imagen may add an invisible <strong>SynthID</strong> watermark in the pixels, which no metadata viewer can read.</em></p>`;
        }
        body.innerHTML = html;
      },
      error(err) {
        metaLine.innerHTML = `<span class="err">Could not read: ${escapeHtml(err.message || String(err))}</span>`;
      },
    };
  }
})();
