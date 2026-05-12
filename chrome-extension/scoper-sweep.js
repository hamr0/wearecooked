"use strict";

// scoper-sweep.js — one-time retroactive sweep of pre-existing cookies.
// Walks chrome.cookies.getAll({}) and runs each cookie through the same
// policy as scoper-listener.js, then chrome.cookies.set's the rewrite.
//
// Triggered on chrome.runtime.onInstalled (install / update / dev-reload)
// and chrome.runtime.onStartup (fresh browser launch). The onChanged
// listener handles every new cookie set after this point.
//
// Why this exists: chrome.cookies.onChanged only fires on new sets, not
// on pre-existing cookies. Without a sweep, cookies set before the
// extension was installed survive at their original (often multi-year)
// expiry until the site happens to refresh them. The sweep retroactively
// applies caps to everything currently in the cookie store.

const SWEEP_BATCH_SIZE = 50;
const SWEEP_BATCH_DELAY_MS = 100;

async function sweepOpenTabETLDSet() {
  const tabs = await chrome.tabs.query({});
  const set = new Set();
  const etld1Of = self.scoperPolicy.etld1Of;
  for (const t of tabs) {
    if (!t.url) continue;
    let host;
    try {
      host = new URL(t.url).hostname;
    } catch (_) {
      continue;
    }
    const e = etld1Of(host);
    if (e) set.add(e);
  }
  return set;
}

async function sweepLoadTrustList() {
  return new Map();
}

function setCookieAsync(details) {
  return new Promise((resolve) => {
    chrome.cookies.set(details, (result) => {
      if (chrome.runtime.lastError || !result) {
        resolve({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, result });
      }
    });
  });
}

const SWEEP_DEDUP_WINDOW_MS = 30 * 1000;

async function initialSweep(trigger) {
  const policy = self.scoperPolicy;
  if (!policy) {
    console.warn("[wearecooked v5 sweep] scoperPolicy not loaded yet (trigger=" + trigger + ")");
    return;
  }

  // Dedup gate: chrome.storage.session is cleared on browser shutdown and
  // extension reload, so this only suppresses repeat sweeps within the
  // same SW lifetime. `manual` bypasses the gate.
  if (trigger !== "manual") {
    try {
      const { lastSweepMs } = await chrome.storage.session.get("lastSweepMs");
      if (lastSweepMs && Date.now() - lastSweepMs < SWEEP_DEDUP_WINDOW_MS) {
        console.log("[wearecooked v5 sweep] skipped — already swept " + Math.round((Date.now() - lastSweepMs) / 1000) + "s ago (trigger=" + trigger + ")");
        return;
      }
      await chrome.storage.session.set({ lastSweepMs: Date.now() });
    } catch (e) {
      // storage.session unavailable -> proceed without gate
    }
  }

  const classify = self.classifyCookie || (() => null);
  console.log("[wearecooked v5 sweep] starting (trigger=" + trigger + ")");

  const cookies = await chrome.cookies.getAll({});
  const openSet = await sweepOpenTabETLDSet();
  const trustList = await sweepLoadTrustList();

  if (openSet.size === 0) {
    console.warn("[wearecooked v5 sweep] skipped — no open tabs to anchor 1p/3p (trigger=" + trigger + "). Will retry on next startup.");
    return;
  }

  let rewrites = 0;
  let demotions = 0;
  let skips = 0;
  let failures = 0;

  for (let i = 0; i < cookies.length; i += SWEEP_BATCH_SIZE) {
    const chunk = cookies.slice(i, i + SWEEP_BATCH_SIZE);
    const tasks = chunk.map(async (cookie) => {
      const cookieETLD = policy.etld1Of(cookie.domain);
      if (!cookieETLD) {
        skips++;
        return;
      }
      const thirdParty = !openSet.has(cookieETLD);
      const cookieClass = classify(cookie.name);
      const decision = policy.decideAction({ cookie, thirdParty, trustList, cookieClass });
      if (decision.action !== "rewrite") {
        skips++;
        return;
      }
      const details = policy.buildSetDetails(cookie, decision.capDays);
      if (!details) {
        skips++;
        return;
      }
      const res = await setCookieAsync(details);
      if (res.ok) {
        rewrites++;
        if (decision.reason === "first-party-tracker-to-session") demotions++;
      } else {
        failures++;
      }
    });
    await Promise.all(tasks);
    if (i + SWEEP_BATCH_SIZE < cookies.length) {
      await new Promise((r) => setTimeout(r, SWEEP_BATCH_DELAY_MS));
    }
  }

  const stats = { scanned: cookies.length, rewrites, demotions, skips, failures };
  console.log("[wearecooked v5 sweep] done (trigger=" + trigger + "):", stats);
  return stats;
}

self.initialSweep = initialSweep;

chrome.runtime.onInstalled.addListener((details) => {
  initialSweep("onInstalled:" + (details && details.reason));
});

chrome.runtime.onStartup.addListener(() => {
  // Tab restore is async; give Chrome ~2s to surface restored tabs before
  // anchoring 1p/3p classification on the open-tab set.
  setTimeout(() => initialSweep("onStartup"), 2000);
});

// SW-load trigger: catches extension reload + any SW wake. The dedup gate
// inside initialSweep prevents thrashing when the SW idles + wakes
// rapidly. This is the most reliable trigger for dev-time iteration.
initialSweep("sw-load");

console.log("[wearecooked v5 sweep] sweep handlers registered (sw-load, onInstalled, onStartup) — manual: self.initialSweep('manual')");
