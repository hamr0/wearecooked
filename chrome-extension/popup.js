"use strict";

// popup.js — wearecooked v5 scoper popup.
//
// Reads chrome.storage.local directly (same extension, full access) for
// stats + trust list, and computes the active tab's eTLD+1 via the
// scoperPolicy module if available. The "Sweep now" button posts a
// "sweep:now" message to the SW so the manual run goes through the
// real sweep code path.

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const [stats, trust, seen, activeTab] = await Promise.all([
    getLocal("scoperStats"),
    getLocal("scoperTrust"),
    getLocal("seenSites"),
    getActiveTab(),
  ]);
  renderStats(stats);
  const etld1 = renderSite(activeTab, trust || {});
  renderAnchor(seen);
  wireSweepButton(etld1);
  if (etld1) renderSiteCookies(etld1);
}

function getCookiesForDomain(domain) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain }, (cs) => resolve(cs || []));
  });
}

async function renderSiteCookies(etld1) {
  const el = document.getElementById("site-cookies");
  const cookies = await getCookiesForDomain(etld1);
  if (cookies.length === 0) {
    el.textContent = "no cookies stored for this domain";
    return;
  }
  const now = Date.now() / 1000;
  let sessionCount = 0;
  let maxExpirySec = 0;
  for (const c of cookies) {
    if (c.session || !c.expirationDate) { sessionCount++; continue; }
    const remaining = c.expirationDate - now;
    if (remaining > maxExpirySec) maxExpirySec = remaining;
  }
  const maxDays = Math.round(maxExpirySec / 86400);
  const persistent = cookies.length - sessionCount;
  const maxClass = maxDays > 90 ? "warn" : (maxDays <= 7 ? "ok" : "");
  el.innerHTML =
    '<div class="row"><span class="label">cookies stored</span><span class="val">' + cookies.length + '</span></div>' +
    '<div class="row"><span class="label">session</span><span class="val">' + sessionCount + '</span></div>' +
    '<div class="row"><span class="label">persistent</span><span class="val">' + persistent + '</span></div>' +
    '<div class="row"><span class="label">longest expiry</span><span class="val ' + maxClass + '">' + (persistent === 0 ? "—" : maxDays + "d") + '</span></div>';
}

function renderAnchor(seen) {
  const count = Array.isArray(seen) ? seen.length : 0;
  document.getElementById("anchor").textContent =
    "1p anchor: " + count + " sites known" + (count < 10 ? " (cron gate opens at 10)" : "");
}

function getLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (obj) => resolve(obj && obj[key]));
  });
}

function setLocal(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function renderStats(stats) {
  const r = (stats && stats.rewrites) || 0;
  const d = (stats && stats.demotions) || 0;
  document.getElementById("stat-rewrites").textContent = r.toLocaleString();
  document.getElementById("stat-demotions").textContent = d.toLocaleString();
  const foot = document.getElementById("stats-foot");
  if (stats && stats.lastSweepAt) {
    foot.textContent = "last sweep " + relativeTime(stats.lastSweepAt);
  } else {
    foot.textContent = "never swept";
  }
}

function relativeTime(ms) {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  return Math.floor(diff / 86_400_000) + "d ago";
}

// ---------------------------------------------------------------------------
// Site classification + trust controls
// ---------------------------------------------------------------------------

function etld1FromHost(host) {
  // Cheap fallback — the SW has the full PSL via scoper.js. Popup ships
  // without psl.js to stay light. For most cases "last 2 labels" matches
  // the PSL answer; for .co.uk-style suffixes it under-counts. We label
  // those visibly in the UI ("unparseable") rather than guess wrong.
  if (!host) return null;
  const cleaned = host.startsWith(".") ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
}

function renderSite(tab, trust) {
  const hostEl = document.getElementById("site-host");
  const classEl = document.getElementById("site-class");
  const buttons = document.querySelectorAll(".trust-btn");

  let host = null;
  try { host = tab && tab.url ? new URL(tab.url).hostname : null; } catch (_) {}
  const etld1 = etld1FromHost(host);

  if (!etld1) {
    hostEl.textContent = host || "—";
    classEl.textContent = "not a regular site";
    classEl.className = "site-class unparseable";
    buttons.forEach((b) => (b.disabled = true));
    document.getElementById("site-cookies").textContent = "—";
    return null;
  }

  hostEl.textContent = etld1;
  const currentTrust = trust[etld1];
  const currentCap = currentTrust ? currentTrust.capDays : 0;

  if (currentCap === 30) {
    classEl.textContent = "trusted · 30 day cap";
    classEl.className = "site-class trusted-30";
  } else if (currentCap === 90) {
    classEl.textContent = "trusted · 90 day cap";
    classEl.className = "site-class trusted-90";
  } else {
    classEl.textContent = "default · 7 day cap";
    classEl.className = "site-class untrusted";
  }

  buttons.forEach((b) => {
    const cap = parseInt(b.dataset.cap, 10);
    b.classList.toggle("active", cap === currentCap);
    b.disabled = cap === currentCap;
    b.onclick = () => handleTrustClick(etld1, cap);
  });

  return etld1;
}

async function handleTrustClick(etld1, cap) {
  const trust = (await getLocal("scoperTrust")) || {};
  if (cap === 0) {
    delete trust[etld1];
  } else {
    trust[etld1] = { capDays: cap, addedAt: Date.now() };
  }
  await setLocal({ scoperTrust: trust });
  // Re-render with the new state. Cookies don't change until the next
  // sweep — site-cookies panel just reflects current store either way.
  const tab = await getActiveTab();
  renderSite(tab, trust);
  renderSiteCookies(etld1);
}

// ---------------------------------------------------------------------------
// Sweep button
// ---------------------------------------------------------------------------

function wireSweepButton(etld1) {
  const btn = document.getElementById("sweep-now");
  const status = document.getElementById("sweep-status");
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = "Sweeping…";
    status.className = "sweep-status";
    status.textContent = "";
    chrome.runtime.sendMessage({ type: "sweep:now" }, async (resp) => {
      await new Promise((r) => setTimeout(r, 200));
      const [stats, seen] = await Promise.all([getLocal("scoperStats"), getLocal("seenSites")]);
      renderStats(stats);
      renderAnchor(seen);
      if (etld1) renderSiteCookies(etld1);
      btn.disabled = false;
      btn.textContent = "Sweep now";
      if (!resp) {
        status.className = "sweep-status";
        status.textContent = "no response from service worker";
      } else if (resp.gated) {
        status.className = "sweep-status gated";
        status.textContent = "gated — only " + resp.anchorSize + " sites known (cron needs ≥10)";
      } else if (typeof resp.scanned === "number") {
        status.className = "sweep-status ok";
        status.textContent =
          "scanned " + resp.scanned + " · rewrote " + resp.rewrites +
          " · demoted " + resp.demotions +
          (resp.failures ? " · " + resp.failures + " failed" : "");
      } else {
        status.className = "sweep-status";
        status.textContent = "policy not loaded yet — reload extension";
      }
    });
  };
}
