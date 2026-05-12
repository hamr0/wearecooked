"use strict";

// popup.js — wearecooked v5 scoper popup (locked card design).
// One card: site line, impact line (state machine), [Sweep now]+[Trust 30d],
// lifetime footer, dashboard link.

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const [stats, trust, activeTab] = await Promise.all([
    getLocal("scoperStats"),
    getLocal("scoperTrust"),
    getActiveTab(),
  ]);
  const etld1 = await renderCard(activeTab, trust || {}, stats || null);
  renderFooter(stats);
  wireButtons(etld1);
  document.getElementById("open-dashboard").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
}

// ---------------------------------------------------------------------------
// Storage + helpers
// ---------------------------------------------------------------------------

function getLocal(key) {
  return new Promise((r) => chrome.storage.local.get(key, (o) => r(o && o[key])));
}
function setLocal(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}
function getActiveTab() {
  return new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t && t[0])));
}
function getCookiesForDomain(domain) {
  return new Promise((r) => chrome.cookies.getAll({ domain }, (cs) => r(cs || [])));
}

// Last-2-labels fallback (popup ships without psl.js — saves ~150KB).
// Multi-part PSL suffixes (.co.uk) fall through to "not a regular site".
// SW's authoritative PSL classification still applies regardless.
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

// ---------------------------------------------------------------------------
// Card rendering
// ---------------------------------------------------------------------------

async function renderCard(tab, trust, stats) {
  const siteLineEl = document.getElementById("site-line");
  const impactEl = document.getElementById("impact");
  const trustBtn = document.getElementById("trust-toggle");

  let host = null;
  try { host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (_) {}
  const etld1 = etld1FromHost(host);

  if (!etld1) {
    siteLineEl.textContent = host || "—";
    impactEl.textContent = "not a regular site — scoper inactive here";
    impactEl.className = "impact warn";
    trustBtn.disabled = true;
    return null;
  }

  const trustEntry = trust[etld1];
  const capDays = trustEntry ? trustEntry.capDays : 7;
  const isTrusted = !!trustEntry;

  // Site line: "nytimes.com · 7 day cap" or "nytimes.com · trusted · 30d cap"
  siteLineEl.innerHTML =
    '<span class="host">' + etld1 + '</span>' +
    '<span class="cap' + (isTrusted ? " trusted" : "") + '">· ' +
    (isTrusted ? "trusted · " + capDays + "d cap" : capDays + " day cap") +
    '</span>';

  // Impact line is a state machine driven by:
  //   1. per-site stats (sweep ran here? how much work?)
  //   2. longest current cookie expiry for this domain
  //   3. trusted vs untrusted
  await renderImpact(etld1, capDays, isTrusted, stats);

  // Trust button toggles 30d ↔ remove. 90d does NOT ship in popup.
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
  const el = document.getElementById("impact");
  const cookies = await getCookiesForDomain(etld1);
  const nowSec = Date.now() / 1000;
  let maxRemainingSec = 0;
  for (const c of cookies) {
    if (c.session || !c.expirationDate) continue;
    const r = c.expirationDate - nowSec;
    if (r > maxRemainingSec) maxRemainingSec = r;
  }
  const maxDays = Math.round(maxRemainingSec / 86400);
  const bySite = (stats && stats.bySite && stats.bySite[etld1]) || null;
  const siteRewrites = bySite ? bySite.rewrites : 0;
  const siteDemotions = bySite ? bySite.demotions : 0;

  // Trusted path: cookies are within their (raised) cap.
  if (isTrusted) {
    if (siteRewrites === 0) {
      el.textContent = "cookies passing through · 0 tightened";
      el.className = "impact ok";
    } else {
      el.textContent =
        "longest cookie " + maxDays + "d → " + capDays + "d · " +
        siteRewrites + " tightened" +
        (siteDemotions > 0 ? ", " + siteDemotions + " killed" : "");
      el.className = "impact";
    }
    return;
  }

  // Untrusted: cap is 7d (default).
  if (siteRewrites === 0 && maxDays <= capDays) {
    el.textContent = "all cookies within cap ✓";
    el.className = "impact ok";
    return;
  }
  if (siteRewrites === 0 && maxDays > capDays) {
    // Pre-first-sweep view OR cookies re-extended since last sweep here.
    el.textContent = "longest cookie " + maxDays + "d → will trim to " + capDays + "d";
    el.className = "impact warn";
    return;
  }
  el.textContent =
    "longest cookie " + maxDays + "d → " + capDays + "d · " +
    siteRewrites + " tightened" +
    (siteDemotions > 0 ? ", " + siteDemotions + " killed" : "");
  el.className = "impact";
}

function renderFooter(stats) {
  const r = (stats && stats.rewrites) || 0;
  const d = (stats && stats.demotions) || 0;
  document.getElementById("lifetime").textContent =
    r.toLocaleString() + " tightened · " + d.toLocaleString() + " killed";
  document.getElementById("last-sweep").textContent =
    stats && stats.lastSweepAt ? "last sweep " + relativeTime(stats.lastSweepAt) : "never swept";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleTrustClick(etld1, cap) {
  const trust = (await getLocal("scoperTrust")) || {};
  if (cap === 0) delete trust[etld1];
  else trust[etld1] = { capDays: cap, addedAt: Date.now() };
  await setLocal({ scoperTrust: trust });
  // Re-render with new state.
  const [tab, stats] = await Promise.all([getActiveTab(), getLocal("scoperStats")]);
  await renderCard(tab, trust, stats);
  renderFooter(stats);
}

function wireButtons(etld1) {
  const btn = document.getElementById("sweep-now");
  const status = document.getElementById("status");
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = "Sweeping…";
    status.className = "status";
    status.textContent = "";
    chrome.runtime.sendMessage({ type: "sweep:now" }, async (resp) => {
      await new Promise((r) => setTimeout(r, 200));
      const [stats, trust, tab] = await Promise.all([
        getLocal("scoperStats"),
        getLocal("scoperTrust"),
        getActiveTab(),
      ]);
      await renderCard(tab, trust || {}, stats);
      renderFooter(stats);
      btn.disabled = false;
      btn.textContent = "Sweep now";
      if (!resp) {
        status.className = "status warn";
        status.textContent = "no response from service worker — reload extension";
      } else if (resp.gated) {
        status.className = "status gated";
        status.textContent = "gated — only " + resp.anchorSize + " sites known (cron needs ≥10; manual bypasses)";
      } else if (typeof resp.scanned === "number") {
        status.className = "status ok";
        status.textContent =
          "scanned " + resp.scanned + " · rewrote " + resp.rewrites +
          " · demoted " + resp.demotions +
          (resp.failures ? " · " + resp.failures + " failed" : "");
      }
    });
  };
}
