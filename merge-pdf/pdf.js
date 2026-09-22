/*
 * Merge PDF — combine multiple PDFs into one, 100% in the browser.
 * Uses pdf-lib (MIT), bundled locally. Pages are copied as-is (lossless);
 * nothing is uploaded.
 */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const { saveBlob, formatBytes, escapeHtml } = window.ImgUtil;

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const results = $("#results");
  const fileList = $("#fileList");
  const mergeBtn = $("#mergeBtn");
  const clearAllBtn = $("#clearAll");
  const status = $("#mergeStatus");

  /** @type {{id:number,file:File}[]} */
  let items = [];
  let seq = 0;
  let dragId = null;

  // ---------- UI wiring ----------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  clearAllBtn.addEventListener("click", () => {
    items = [];
    render();
    results.hidden = true;
    status.hidden = true;
  });

  mergeBtn.addEventListener("click", merge);

  // ---------- State ----------
  function addFiles(fileListLike) {
    const pdfs = Array.from(fileListLike).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (pdfs.length === 0) {
      if (fileListLike.length) alert("Please choose PDF files.");
      return;
    }
    for (const file of pdfs) items.push({ id: ++seq, file });
    results.hidden = false;
    status.hidden = true;
    render();
  }

  function move(id, dir) {
    const i = items.findIndex((it) => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    render();
  }

  function remove(id) {
    items = items.filter((it) => it.id !== id);
    if (items.length === 0) results.hidden = true;
    render();
  }

  function reorderByDrag(fromId, toId) {
    if (fromId === toId) return;
    const from = items.findIndex((it) => it.id === fromId);
    const to = items.findIndex((it) => it.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    render();
  }

  // ---------- Render ----------
  function render() {
    fileList.innerHTML = "";
    items.forEach((it, idx) => {
      const el = document.createElement("li");
      el.className = "file-item pdf-row";
      el.draggable = true;

      el.addEventListener("dragstart", () => { dragId = it.id; el.classList.add("dragging"); });
      el.addEventListener("dragend", () => { dragId = null; el.classList.remove("dragging"); });
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => { e.preventDefault(); if (dragId != null) reorderByDrag(dragId, it.id); });

      const thumb = document.createElement("div");
      thumb.className = "thumb pdf-thumb";
      thumb.textContent = "📄";

      const info = document.createElement("div");
      info.className = "file-info";
      info.innerHTML = `<div class="file-name">${idx + 1}. ${escapeHtml(it.file.name)}</div>
        <div class="file-meta">${formatBytes(it.file.size)}</div>`;

      const actions = document.createElement("div");
      actions.className = "file-actions";
      actions.appendChild(iconBtn("↑", "Move up", idx === 0, () => move(it.id, -1)));
      actions.appendChild(iconBtn("↓", "Move down", idx === items.length - 1, () => move(it.id, 1)));
      actions.appendChild(iconBtn("✕", "Remove", false, () => remove(it.id)));

      el.append(thumb, info, actions);
      fileList.appendChild(el);
    });
    mergeBtn.disabled = items.length < 2;
  }

  function iconBtn(label, title, disabled, onClick) {
    const b = document.createElement("button");
    b.className = "btn btn-ghost icon-btn";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------- Merge ----------
  async function merge() {
    if (items.length < 2) return;
    mergeBtn.disabled = true;
    status.hidden = false;
    status.textContent = "Merging…";
    try {
      const { PDFDocument } = window.PDFLib;
      const out = await PDFDocument.create();
      let totalPages = 0;

      for (const it of items) {
        const bytes = new Uint8Array(await it.file.arrayBuffer());
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        totalPages += pages.length;
      }

      const merged = await out.save();
      const blob = new Blob([merged], { type: "application/pdf" });
      saveBlob(blob, "merged.pdf");
      status.innerHTML = `<span class="save">✓ Merged ${totalPages} pages from ${items.length} files → ${formatBytes(blob.size)}.</span>`;
    } catch (err) {
      console.error(err);
      status.innerHTML = `<span class="err">Could not merge: ${escapeHtml(err.message || String(err))}. (A password-protected PDF may need to be unlocked first.)</span>`;
    } finally {
      mergeBtn.disabled = items.length < 2;
    }
  }
})();
