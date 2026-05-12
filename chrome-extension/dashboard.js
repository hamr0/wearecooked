"use strict";

// dashboard.js — wearecooked v5 scoper dashboard.
// Four blocks: hero, trusted sites, settings (sweep period), recent activity.
// Reads all state from chrome.storage.local directly; writes go through
// either storage.local (for scoperTrust / scoperSettings) or a runtime
// message to the SW for settings:reload after a period change.

const ALARM_PERIOD_CHOICES = [15, 60, 240, 720];
const ACTIVITY_INITIAL_ROWS = 10;
const ACTIVITY_MAX_ROWS = 50;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const [stats, trust, settings, history, seen] = await Promise.all([
    getLocal("scoperStats"),
    getLocal("scoperTrust"),
    getLocal("scoperSettings"),
    getLocal("scoperHistory"),
    getLocal("seenSites"),
  ]);

  renderHero(stats, seen);
  await renderTrustedSites(trust || {});
  renderSettings(settings);
  renderActivity(seen, history || []);

  wireAddRow();
  wireSettingsRadios();
  wireActivityToggle();
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getLocal(key) {
  return new Promise((r) => chrome.storage.local.get(key, (o) => r(o && o[key])));
}
function setLocal(obj) {
  return new Promise((r) => chrome.storage.local.set(obj, r));
}
function getCookieCount(domain) {
  return new Promise((r) => chrome.cookies.getAll({ domain }, (cs) => r((cs || []).length)));
}

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

function fmtClock(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function renderHero(stats, seen) {
  const r = (stats && stats.rewrites) || 0;
  const d = (stats && stats.demotions) || 0;
  const sites = Array.isArray(seen) ? seen.length : 0;
  document.getElementById("hero-tightened").textContent = r.toLocaleString();
  document.getElementById("hero-killed").textContent = d.toLocaleString();
  document.getElementById("hero-sites").textContent = sites.toLocaleString();
  document.getElementById("hero-last").textContent =
    stats && stats.lastSweepAt ? relativeTime(stats.lastSweepAt) : "never";
}

// ---------------------------------------------------------------------------
// Trusted sites
// ---------------------------------------------------------------------------

async function renderTrustedSites(trust) {
  const tbody = document.getElementById("trust-rows");
  const countEl = document.getElementById("trust-count");
  const entries = Object.entries(trust);
  countEl.textContent = entries.length > 0 ? "· " + entries.length : "";

  if (entries.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No trusted sites yet — visit a site you care about and click <em>Trust 30d</em> in the popup, or add one below.</td></tr>';
    return;
  }

  // Sort by addedAt desc (most recent trust first).
  entries.sort(([, a], [, b]) => (b.addedAt || 0) - (a.addedAt || 0));

  // Fetch cookie counts in parallel; render in deterministic order.
  const counts = await Promise.all(entries.map(([etld1]) => getCookieCount(etld1)));

  tbody.innerHTML = "";
  entries.forEach(([etld1, entry], i) => {
    const row = document.createElement("tr");

    const dCell = document.createElement("td");
    dCell.className = "domain";
    dCell.textContent = etld1;
    row.appendChild(dCell);

    const tCell = document.createElement("td");
    tCell.className = "tier";
    tCell.textContent = entry.capDays + "d";
    row.appendChild(tCell);

    const cCell = document.createElement("td");
    cCell.className = "cookies";
    cCell.textContent = counts[i];
    row.appendChild(cCell);

    const aCell = document.createElement("td");
    aCell.className = "actions-col";
    const flipTo = entry.capDays === 30 ? 90 : 30;
    const flipBtn = document.createElement("button");
    flipBtn.className = "row-btn flip";
    flipBtn.textContent = "→ " + flipTo + "d";
    flipBtn.onclick = () => handleFlip(etld1, flipTo);
    aCell.appendChild(flipBtn);

    const rmBtn = document.createElement("button");
    rmBtn.className = "row-btn remove";
    rmBtn.textContent = "✕";
    rmBtn.title = "Remove trust";
    rmBtn.onclick = () => handleRemove(etld1);
    aCell.appendChild(rmBtn);

    row.appendChild(aCell);
    tbody.appendChild(row);
  });
}

async function handleFlip(etld1, newCap) {
  const trust = (await getLocal("scoperTrust")) || {};
  if (!trust[etld1]) return;
  trust[etld1] = { capDays: newCap, addedAt: trust[etld1].addedAt || Date.now() };
  await setLocal({ scoperTrust: trust });
  await renderTrustedSites(trust);
}

async function handleRemove(etld1) {
  const trust = (await getLocal("scoperTrust")) || {};
  delete trust[etld1];
  await setLocal({ scoperTrust: trust });
  await renderTrustedSites(trust);
}

function wireAddRow() {
  const btn = document.getElementById("add-btn");
  const input = document.getElementById("add-domain");
  const tierEl = document.getElementById("add-tier");
  const err = document.getElementById("add-error");

  const submit = async () => {
    err.textContent = "";
    const raw = input.value.trim().toLowerCase();
    if (!raw) {
      err.textContent = "enter a domain";
      return;
    }
    let host = raw;
    try { host = new URL(raw.includes("://") ? raw : "https://" + raw).hostname; } catch (_) {}
    const etld1 = etld1FromHost(host);
    if (!etld1) {
      err.textContent = "not a valid domain";
      return;
    }
    const cap = parseInt(tierEl.value, 10);
    if (cap !== 30 && cap !== 90) {
      err.textContent = "tier must be 30 or 90";
      return;
    }
    const trust = (await getLocal("scoperTrust")) || {};
    trust[etld1] = { capDays: cap, addedAt: Date.now() };
    await setLocal({ scoperTrust: trust });
    input.value = "";
    tierEl.value = "30";
    await renderTrustedSites(trust);
  };

  btn.onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function renderSettings(settings) {
  const current = (settings && ALARM_PERIOD_CHOICES.includes(settings.alarmPeriodMin))
    ? settings.alarmPeriodMin
    : 60;
  const radios = document.querySelectorAll('input[name="period"]');
  radios.forEach((r) => { r.checked = parseInt(r.value, 10) === current; });
}

function wireSettingsRadios() {
  const radios = document.querySelectorAll('input[name="period"]');
  const status = document.getElementById("period-status");
  radios.forEach((r) => {
    r.addEventListener("change", async () => {
      const period = parseInt(r.value, 10);
      if (!ALARM_PERIOD_CHOICES.includes(period)) return;
      await setLocal({ scoperSettings: { alarmPeriodMin: period } });
      status.textContent = "applying…";
      chrome.runtime.sendMessage({ type: "settings:reload" }, () => {
        status.textContent = "applied · next sweep in " + period + " min";
        setTimeout(() => { status.textContent = ""; }, 3000);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function renderActivity(seen, history) {
  const anchor = document.getElementById("anchor-line");
  const sites = Array.isArray(seen) ? seen.length : 0;
  const gateOpen = sites >= 10;
  anchor.textContent = "1p anchor: " + sites + " sites watched · gate opens at 10 " +
    (gateOpen ? "(open)" : "(closed — auto-sweeps gated)");
  anchor.className = "anchor-line " + (gateOpen ? "open" : "gated");

  renderActivityRows(history, ACTIVITY_INITIAL_ROWS);

  const showAll = document.getElementById("activity-show-all");
  if (history.length <= ACTIVITY_INITIAL_ROWS) {
    showAll.classList.add("hidden");
  } else {
    showAll.classList.remove("hidden");
    showAll.onclick = () => {
      renderActivityRows(history, ACTIVITY_MAX_ROWS);
      showAll.classList.add("hidden");
    };
  }
}

function renderActivityRows(history, limit) {
  const tbody = document.getElementById("activity-rows");
  tbody.innerHTML = "";
  if (history.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.style.color = "#666";
    td.style.fontStyle = "italic";
    td.style.padding = "12px 10px";
    td.textContent = "no sweeps recorded yet";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  history.slice(0, limit).forEach((h) => {
    const row = document.createElement("tr");

    const t = document.createElement("td");
    t.textContent = fmtClock(h.at);
    row.appendChild(t);

    const trig = document.createElement("td");
    const trigKind = h.gated ? "gated" : (h.trigger.split(":")[0] || h.trigger);
    trig.className = "trigger " + trigKind;
    trig.textContent = h.gated ? "gated" : h.trigger;
    row.appendChild(trig);

    const s = document.createElement("td");
    s.className = "num";
    s.textContent = h.scanned.toLocaleString();
    row.appendChild(s);

    const r = document.createElement("td");
    r.className = "num";
    r.textContent = h.rewrites.toLocaleString();
    row.appendChild(r);

    const d = document.createElement("td");
    d.className = "num";
    d.textContent = h.demotions.toLocaleString();
    row.appendChild(d);

    tbody.appendChild(row);
  });
}

function wireActivityToggle() {
  const btn = document.getElementById("activity-toggle");
  const body = document.getElementById("activity-body");
  btn.onclick = () => {
    const collapsed = body.classList.toggle("collapsed");
    btn.textContent = collapsed ? "▾" : "▴";
  };
}
