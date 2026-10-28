/*
 * Private tools: links to self-hosted tools that live on the owner's own
 * network. Nothing about them is stored in this public site. A private tool
 * page links here once as  .../toolbox/#vyt=<its address>  to remember itself
 * in this browser. Its card then shows in that browser only; every other
 * visitor sees nothing. (No reachability check: browsers block a public page
 * from probing private network addresses without a permission prompt.)
 */
(() => {
  "use strict";

  const KEY = "toolbox.private.vyt";

  function remember() {
    const m = location.hash.match(/^#vyt=(.+)$/);
    if (!m) return;
    try {
      const url = new URL(decodeURIComponent(m[1]));
      if (url.protocol === "https:") localStorage.setItem(KEY, url.origin);
    } catch (_) { /* bad link or storage blocked: ignore */ }
    history.replaceState(null, "", location.pathname + location.search);
  }

  function reveal() {
    let base = null;
    try { base = localStorage.getItem(KEY); } catch (_) { return; }
    if (!base) return;
    document.querySelectorAll("[data-private-tool='vyt']").forEach((el) => {
      el.href = base + "/";
      el.hidden = false;
    });
  }

  remember();
  reveal();
})();
