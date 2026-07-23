/* delivery-report client behaviour. ASCII-only (Appendix C pitfall 1: entities do not
 * decode inside <script>). No external calls; pure DOM. */
(function () {
  "use strict";

  /* ---- theme toggle: a viewer choice that wins over the media query (Sec 4.2) ---- */
  var root = document.documentElement;
  var toggle = document.querySelector(".theme-toggle");
  function currentMode() {
    var set = root.getAttribute("data-theme");
    if (set) return set;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function paintToggle() {
    if (!toggle) return;
    var next = currentMode() === "dark" ? "light" : "dark";
    toggle.textContent = next === "dark" ? "Dark" : "Light";
    toggle.setAttribute("aria-label", "Switch to " + next + " theme");
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      root.setAttribute("data-theme", currentMode() === "dark" ? "light" : "dark");
      paintToggle();
    });
    paintToggle();
  }

  /* ---- feature-route toolbar: copy summary + print ---- */
  var copySummary = document.querySelector("[data-copy-summary]");
  if (copySummary) {
    copySummary.addEventListener("click", function () {
      var lede = document.querySelector("[data-summary]");
      if (lede) writeText(lede.textContent.trim() + "\n", copySummary, "Copied");
    });
  }
  var printBtn = document.querySelector("[data-print]");
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });

  /* ---- per-<code> inline copy (feature route, Sec 7.4) ---- */
  document.addEventListener("click", function (ev) {
    var c = ev.target && ev.target.closest ? ev.target.closest("code.copyable") : null;
    if (!c) return;
    writeText(c.textContent, c, null, function () {
      c.classList.add("done");
      window.setTimeout(function () { c.classList.remove("done"); }, 1200);
    });
  });

  /* ---- handoff copy component: three-tier degrade path.
   * The settled/guard race is load-bearing: Chrome can leave writeText's promise
   * permanently pending when the click carries no user activation. ---- */
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-1000px";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function revealForManualCopy(body, text) {
    var existing = body.querySelector(".ns-fallback");
    if (existing) { existing.focus(); existing.select(); return; }
    var ta = document.createElement("textarea");
    ta.className = "ns-fallback";
    ta.value = text;
    ta.setAttribute("aria-label", "Handoff text - select and copy manually");
    body.insertBefore(ta, body.querySelector(".ns-foot"));
    ta.focus(); ta.select();
  }
  function flash(btn, label) {
    if (!btn.getAttribute("data-label")) btn.setAttribute("data-label", btn.textContent);
    btn.textContent = label; btn.classList.add("done");
    window.setTimeout(function () {
      btn.textContent = btn.getAttribute("data-label");
      btn.classList.remove("done");
    }, 1600);
  }
  /* Shared writer used by summary + inline-code copy (single tier + fallback). */
  function writeText(text, btn, okLabel, onOk) {
    function done() { if (onOk) onOk(); else if (btn && okLabel) flash(btn, okLabel); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var settled = false;
      var guard = window.setTimeout(function () {
        if (!settled) { settled = true; if (fallbackCopy(text)) done(); }
      }, 1200);
      navigator.clipboard.writeText(text).then(
        function () { if (settled) return; settled = true; window.clearTimeout(guard); done(); },
        function () { if (settled) return; settled = true; window.clearTimeout(guard); if (fallbackCopy(text)) done(); }
      );
    } else if (fallbackCopy(text)) { done(); }
  }

  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest(".copy-btn") : null;
    if (!btn) return;
    var body = btn.closest(".ns-body");
    var payload = body ? body.querySelector(".ns-payload") : null;
    if (!payload) return;
    var text = payload.textContent.replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
    function degrade() {
      if (fallbackCopy(text)) { flash(btn, "Copied"); return; }
      revealForManualCopy(body, text);
      flash(btn, "Copy manually");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      var settled = false;
      var guard = window.setTimeout(function () {
        if (!settled) { settled = true; degrade(); }
      }, 1200);
      navigator.clipboard.writeText(text).then(
        function () { if (settled) return; settled = true; window.clearTimeout(guard); flash(btn, "Copied"); },
        function () { if (settled) return; settled = true; window.clearTimeout(guard); degrade(); }
      );
    } else {
      degrade();
    }
  });
})();
