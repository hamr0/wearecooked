"use strict";

// popup-card.js — render the Cookie scoper card inside wearehere's popup.
// All data access goes through self.scoperDataLayer (set by scoper-bridge.js).
// Load order matters: scoper-bridge.js BEFORE this file.

(function () {
  if (!self.scoperDataLayer) {
    console.error("[scoper] popup-card.js loaded before scoper-bridge.js");
    return;
  }

  const dl = self.scoperDataLayer;

  // Expose init for hosts that don't use DOMContentLoaded (lazy tabs, etc.)
  self.wearecookedScoper = self.wearecookedScoper || {};
  self.wearecookedScoper.initPopupCard = init;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  async function autoInit() {
    if (document.querySelector(".scoper-card")) await init();
  }

  async function init() {
    const [state, tab] = await Promise.all([dl.getState(), dl.getActiveTab()]);
    const trust = (state && state.scoperTrust) || {};
    const stats = (state && state.scoperStats) || null;

    const etld1 = await renderCard(tab, trust, stats);
    renderFooter(stats);
    wireButtons(etld1);

    const openLink = document.getElementById("scoper-open-dashboard");
    if (openLink) {
      openLink.addEventListener("click", (e) => {
        e.preventDefault();
        dl.openDashboard();
      });
    }
  }

  // ---- helpers -----------------------------------------------------------

  function etld1FromHost(host) {
    if (!host) return null;
    const cleaned = host.startsWith(".") ? host.slice(1) : host;
    const labels = cleaned.toLowerCase().split(".").filter(Boolean);
    if (labels.length < 2) return null;
    return labels.slice(-2).join(".");
  }

  function relativeTime(ms) {
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
    return Math.floor(diff / 86_400_000) + "d ago";
  }

  // ---- card render -------------------------------------------------------

  async function renderCard(tab, trust, stats) {
    const siteLineEl = document.getElementById("scoper-site-line");
    const impactEl = document.getElementById("scoper-impact");
    const trustBtn = document.getElementById("scoper-trust-toggle");

    let host = null;
    try { host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (_) {}
    const etld1 = etld1FromHost(host);

    if (!etld1) {
      siteLineEl.textContent = host || "—";
      impactEl.textContent = "not a regular site — scoper inactive here";
      impactEl.className = "scoper-impact warn";
      trustBtn.disabled = true;
      return null;
    }

    const trustEntry = trust[etld1];
    const capDays = trustEntry ? trustEntry.capDays : 7;
    const isTrusted = !!trustEntry;

    siteLineEl.innerHTML =
      '<span class="host">' + etld1 + '</span>' +
      '<span class="cap' + (isTrusted ? " trusted" : "") + '">· ' +
      (isTrusted ? "trusted · " + capDays + "d cap" : capDays + " day cap") +
      '</span>';

    await renderImpact(etld1, capDays, isTrusted, stats);

    if (isTrusted) {
      trustBtn.textContent = "Remove trust";
      trustBtn.classList.add("trusted");
      trustBtn.disabled = false;
      trustBtn.onclick = () => handleTrustClick(etld1, 0);
    } else {
      trustBtn.textContent = "Trust 30d";
      trustBtn.classList.remove("trusted");
      trustBtn.disabled = false;
      trustBtn.onclick = () => handleTrustClick(etld1, 30);
    }

    return etld1;
  }

  async function renderImpact(etld1, capDays, isTrusted, stats) {
    const el = document.getElementById("scoper-impact");
    // Longest current expiry comes from chrome.cookies directly (fast,
    // requires "cookies" permission on wearehere — see INTEGRATION-GUIDE
    // step 6).
    let maxDays = 0;
    if (chrome.cookies && chrome.cookies.getAll) {
      const cookies = await new Promise((r) =>
        chrome.cookies.getAll({ domain: etld1 }, (cs) => r(cs || []))
      );
      const nowSec = Date.now() / 1000;
      let maxRemainingSec = 0;
      for (const c of cookies) {
        if (c.session || !c.expirationDate) continue;
        const r = c.expirationDate - nowSec;
        if (r > maxRemainingSec) maxRemainingSec = r;
      }
      maxDays = Math.round(maxRemainingSec / 86400);
    }

    const bySite = (stats && stats.bySite && stats.bySite[etld1]) || null;
    const siteRewrites = bySite ? bySite.rewrites : 0;
    const siteDemotions = bySite ? bySite.demotions : 0;

    if (isTrusted) {
      if (siteRewrites === 0) {
        el.textContent = "cookies passing through · 0 tightened";
        el.className = "scoper-impact ok";
      } else {
        el.textContent =
          "longest cookie " + maxDays + "d → " + capDays + "d · " +
          siteRewrites + " tightened" +
          (siteDemotions > 0 ? ", " + siteDemotions + " killed" : "");
        el.className = "scoper-impact";
      }
      return;
    }
    if (siteRewrites === 0 && maxDays <= capDays) {
      el.textContent = "all cookies within cap ✓";
      el.className = "scoper-impact ok";
      return;
    }
    if (siteRewrites === 0 && maxDays > capDays) {
      el.textContent = "longest cookie " + maxDays + "d → will trim to " + capDays + "d";
      el.className = "scoper-impact warn";
      return;
    }
    el.textContent =
      "longest cookie " + maxDays + "d → " + capDays + "d · " +
      siteRewrites + " tightened" +
      (siteDemotions > 0 ? ", " + siteDemotions + " killed" : "");
    el.className = "scoper-impact";
  }

  function renderFooter(stats) {
    const r = (stats && stats.rewrites) || 0;
    const d = (stats && stats.demotions) || 0;
    document.getElementById("scoper-lifetime").textContent =
      r.toLocaleString() + " tightened · " + d.toLocaleString() + " killed";
    document.getElementById("scoper-last-sweep").textContent =
      stats && stats.lastSweepAt ? "last sweep " + relativeTime(stats.lastSweepAt) : "never swept";
  }

  // ---- actions -----------------------------------------------------------

  async function handleTrustClick(etld1, cap) {
    await dl.setTrust(etld1, cap);
    const [state, tab] = await Promise.all([dl.getState(), dl.getActiveTab()]);
    await renderCard(tab, (state && state.scoperTrust) || {}, (state && state.scoperStats) || null);
    renderFooter((state && state.scoperStats) || null);
  }

  function wireButtons(_etld1) {
    const btn = document.getElementById("scoper-sweep-now");
    const status = document.getElementById("scoper-status");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Sweeping…";
      status.className = "scoper-status";
      status.textContent = "";
      const resp = await dl.sweepNow();
      // Small delay so status is readable + storage write settles.
      await new Promise((r) => setTimeout(r, 200));
      const [state, tab] = await Promise.all([dl.getState(), dl.getActiveTab()]);
      await renderCard(tab, (state && state.scoperTrust) || {}, (state && state.scoperStats) || null);
      renderFooter((state && state.scoperStats) || null);
      btn.disabled = false;
      btn.textContent = "Sweep now";
      if (!resp || resp.error) {
        status.className = "scoper-status warn";
        status.textContent = resp && resp.error
          ? "error: " + resp.error
          : "no response from wearecooked — check extension ID handshake";
      } else if (resp.gated) {
        status.className = "scoper-status gated";
        status.textContent =
          "gated — only " + resp.anchorSize + " sites known (cron needs ≥10; manual bypasses)";
      } else if (typeof resp.scanned === "number") {
        status.className = "scoper-status ok";
        status.textContent =
          "scanned " + resp.scanned + " · rewrote " + resp.rewrites +
          " · demoted " + resp.demotions +
          (resp.failures ? " · " + resp.failures + " failed" : "");
      }
    };
  }
})();
