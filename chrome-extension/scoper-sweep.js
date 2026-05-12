"use strict";

// scoper-sweep.js — cron-driven retroactive cookie scoping.
//
// Replaces the live chrome.cookies.onChanged listener with a periodic
// alarm. Every ALARM_PERIOD_MIN minutes (default 4h) the SW wakes,
// queries chrome.cookies.getAll, classifies each as 1p/3p against
// `seenSites ∪ currentlyOpenTabs`, and rewrites where policy demands.
//
// 1p/3p signal:
//   seenSites: persistent Set<eTLD+1> in chrome.storage.local, populated
//     by chrome.tabs.onUpdated whenever an http(s) page finishes loading.
//     Survives SW restarts and gives the sweep an accurate "sites the
//     user actually visits" anchor — robust where the listener's
//     any-open-tab lookup was racy at SW wake.
//
// Gate: sweep skips if combined etldSet has fewer than
// MIN_SEEN_SITES_FOR_SWEEP entries. Prevents the first-install case
// where seenSites is empty from mis-classifying every cookie as 3p.

const ALARM_NAME = "scoper-sweep";
const ALARM_PERIOD_MIN = 240;            // 4h cadence
const ALARM_FIRST_DELAY_MIN = 1;         // first fire 1min after install/startup
const MIN_SEEN_SITES_FOR_SWEEP = 10;     // gate to avoid over-demotion on cold start

const SWEEP_BATCH_SIZE = 50;
const SWEEP_BATCH_DELAY_MS = 100;
const SWEEP_DEDUP_WINDOW_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// seenSites: persistent Set<eTLD+1>
//
// Memoized in-memory cache so concurrent tabs.onUpdated events mutate
// the same Set instance — without this, two near-simultaneous page loads
// each do read-modify-write against storage and the second write
// clobbers the first. The Promise is the cache key so only one storage
// read happens per SW lifetime; subsequent calls hit the resolved Set.
// ---------------------------------------------------------------------------

let seenSitesPromise = null;

function seenSitesGet() {
  if (!seenSitesPromise) {
    seenSitesPromise = (async () => {
      const { seenSites } = await chrome.storage.local.get("seenSites");
      return new Set(Array.isArray(seenSites) ? seenSites : []);
    })();
  }
  return seenSitesPromise;
}

async function seenSitesAdd(host) {
  if (!host) return;
  const policy = self.scoperPolicy;
  if (!policy) return;
  const etld1 = policy.etld1Of(host);
  if (!etld1) return;
  const set = await seenSitesGet();
  if (set.has(etld1)) return;
  set.add(etld1);
  // All concurrent callers share `set`, so each write serializes the
  // full current state — last write wins but contains every addition.
  await chrome.storage.local.set({ seenSites: Array.from(set) });
}

async function sweepETLDSet() {
  const set = await seenSitesGet();
  const tabs = await chrome.tabs.query({});
  const etld1Of = self.scoperPolicy.etld1Of;
  for (const t of tabs) {
    if (!t.url) continue;
    let host;
    try { host = new URL(t.url).hostname; } catch (_) { continue; }
    const e = etld1Of(host);
    if (e) set.add(e);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

async function sweepLoadTrustList() {
  // Step 4 (popup) will populate this from chrome.storage.local.scoperTrust.
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

async function initialSweep(trigger) {
  const policy = self.scoperPolicy;
  if (!policy) {
    console.warn("[wearecooked v5 sweep] scoperPolicy not loaded yet (trigger=" + trigger + ")");
    return;
  }

  // Dedup gate: chrome.storage.session clears on browser shutdown +
  // extension reload. Suppresses repeat sweeps within an SW lifetime.
  // `manual` bypasses for the console diagnostic path.
  if (trigger !== "manual") {
    try {
      const { lastSweepMs } = await chrome.storage.session.get("lastSweepMs");
      if (lastSweepMs && Date.now() - lastSweepMs < SWEEP_DEDUP_WINDOW_MS) {
        console.log("[wearecooked v5 sweep] skipped — already swept " + Math.round((Date.now() - lastSweepMs) / 1000) + "s ago (trigger=" + trigger + ")");
        return;
      }
      await chrome.storage.session.set({ lastSweepMs: Date.now() });
    } catch (_) {
      // storage.session unavailable -> proceed without gate
    }
  }

  const etldSet = await sweepETLDSet();
  if (etldSet.size < MIN_SEEN_SITES_FOR_SWEEP) {
    console.log("[wearecooked v5 sweep] gated — only " + etldSet.size + " sites in 1p set, need " + MIN_SEEN_SITES_FOR_SWEEP + " (trigger=" + trigger + ")");
    return { scanned: 0, rewrites: 0, demotions: 0, skips: 0, failures: 0, gated: true };
  }

  const classify = self.classifyCookie || (() => null);
  console.log("[wearecooked v5 sweep] starting (trigger=" + trigger + ", 1p-set=" + etldSet.size + ")");

  const cookies = await chrome.cookies.getAll({});
  const trustList = await sweepLoadTrustList();

  let rewrites = 0;
  let demotions = 0;
  let skips = 0;
  let failures = 0;

  for (let i = 0; i < cookies.length; i += SWEEP_BATCH_SIZE) {
    const chunk = cookies.slice(i, i + SWEEP_BATCH_SIZE);
    const tasks = chunk.map(async (cookie) => {
      const cookieETLD = policy.etld1Of(cookie.domain);
      if (!cookieETLD) { skips++; return; }
      const thirdParty = !etldSet.has(cookieETLD);
      const cookieClass = classify(cookie.name);
      const decision = policy.decideAction({ cookie, thirdParty, trustList, cookieClass });
      if (decision.action !== "rewrite") { skips++; return; }
      const details = policy.buildSetDetails(cookie, decision.capDays);
      if (!details) { skips++; return; }
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
  await updateScoperStats(rewrites, demotions);
  console.log("[wearecooked v5 sweep] done (trigger=" + trigger + "):", stats);
  return stats;
}

// Lifetime counters surfaced in the popup. Only the work-done path
// updates these — gated sweeps don't touch them. Reads + writes are
// not concurrency-protected because the dedup gate makes overlapping
// sweeps in production effectively impossible.
async function updateScoperStats(deltaRewrites, deltaDemotions) {
  const { scoperStats } = await chrome.storage.local.get("scoperStats");
  const prev = scoperStats || { rewrites: 0, demotions: 0 };
  await chrome.storage.local.set({
    scoperStats: {
      rewrites: prev.rewrites + deltaRewrites,
      demotions: prev.demotions + deltaDemotions,
      lastSweepAt: Date.now(),
    },
  });
}

self.initialSweep = initialSweep;
self.seenSitesAdd = seenSitesAdd;
self.seenSitesGet = seenSitesGet;

// ---------------------------------------------------------------------------
// Trigger plumbing
// ---------------------------------------------------------------------------

// Build seenSites incrementally as the user browses.
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.status !== "complete") return;
  if (!tab || !tab.url) return;
  let host;
  try { host = new URL(tab.url).hostname; } catch (_) { return; }
  if (host) seenSitesAdd(host);
});

// Cron. Alarms don't persist across browser restarts in MV3, so create
// on both install and startup. chrome.alarms.create is idempotent by
// name within a single session.
function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_FIRST_DELAY_MIN,
    periodInMinutes: ALARM_PERIOD_MIN,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) initialSweep("alarm");
});

chrome.runtime.onInstalled.addListener((details) => {
  ensureAlarm();
  initialSweep("onInstalled:" + (details && details.reason));
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  // Tab restore is async — give Chrome ~2s to surface restored tabs
  // before reading the open-tab set into the 1p anchor.
  setTimeout(() => initialSweep("onStartup"), 2000);
});

console.log("[wearecooked v5 sweep] cron + seen-sites handlers registered (alarm=" + ALARM_PERIOD_MIN + "min, gate=" + MIN_SEEN_SITES_FOR_SWEEP + " sites). Manual: self.initialSweep('manual')");
