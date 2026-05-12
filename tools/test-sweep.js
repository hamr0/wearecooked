#!/usr/bin/env node
"use strict";

// test-sweep.js — deterministic Node harness for the scoper sweep.
//
// Stubs chrome.cookies / chrome.tabs / chrome.storage / chrome.alarms /
// chrome.runtime, loads psl.js + cookie-database.js + scoper.js +
// scoper-sweep.js into a vm context, seeds fixtures, runs the sweep,
// and asserts per-cookie outcomes. No browser, no manual validation.
//
// Run: node tools/test-sweep.js
// Exit 0 = all pass; exit 1 = any fail.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SEC_PER_DAY = 86400;
const NOW_SEC = Math.floor(Date.now() / 1000);

// In-memory cookie store. Keyed by `${domain}|${path}|${name}` so the
// stub mimics chrome.cookies' uniqueness rules well enough for the
// sweep, which only reads getAll() and writes via set().
const cookieStore = new Map();
function cookieKey(c) { return c.domain + "|" + c.path + "|" + c.name; }

let openTabs = [];
const sessionStorage = new Map();
const localStorage = new Map();
const alarms = new Map();
const onAlarmListeners = [];
const onTabsUpdatedListeners = [];

const cookiesApi = {
  getAll(_query) {
    // Return a snapshot copy so the sweep can't mutate our store directly.
    return Promise.resolve(Array.from(cookieStore.values()).map((c) => ({ ...c })));
  },
  set(details, cb) {
    // Mimic the subset of chrome.cookies.set semantics that buildSetDetails
    // exercises: `details.domain` absent => host-bound cookie (no leading
    // dot in resulting cookie.domain); present => domain cookie (leading
    // dot preserved). expirationDate absent => session cookie.
    const isHostOnly = !details.domain;
    const resolvedDomain = isHostOnly
      ? new URL(details.url).hostname
      : details.domain;
    const stored = {
      name: details.name,
      value: details.value,
      domain: resolvedDomain,
      path: details.path,
      secure: !!details.secure,
      httpOnly: !!details.httpOnly,
      sameSite: details.sameSite || "unspecified",
      hostOnly: isHostOnly,
      session: details.expirationDate === undefined,
      storeId: details.storeId || "0",
    };
    if (!stored.session) stored.expirationDate = details.expirationDate;
    cookieStore.set(cookieKey(stored), stored);
    cb(stored);
  },
};

const tabsApi = {
  query(_q) {
    return Promise.resolve(openTabs.map((t) => ({ ...t })));
  },
  onUpdated: {
    addListener(fn) { onTabsUpdatedListeners.push(fn); },
  },
};

function makeStorageArea(store) {
  return {
    get(key) {
      const out = {};
      if (typeof key === "string") {
        if (store.has(key)) out[key] = store.get(key);
      } else if (Array.isArray(key)) {
        for (const k of key) if (store.has(k)) out[k] = store.get(k);
      } else if (key === null || key === undefined) {
        for (const [k, v] of store) out[k] = v;
      }
      return Promise.resolve(out);
    },
    set(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
      return Promise.resolve();
    },
  };
}

const storageApi = {
  session: makeStorageArea(sessionStorage),
  local: makeStorageArea(localStorage),
};

const alarmsApi = {
  create(name, info) { alarms.set(name, info); },
  clear(name) { return Promise.resolve(alarms.delete(name)); },
  onAlarm: {
    addListener(fn) { onAlarmListeners.push(fn); },
  },
};

const runtimeApi = {
  // Sweep registers onInstalled/onStartup handlers at module load —
  // capture but don't auto-fire; tests invoke initialSweep directly.
  onInstalled: { addListener(_fn) { /* no-op */ } },
  onStartup: { addListener(_fn) { /* no-op */ } },
  lastError: null,
};

const chromeStub = {
  cookies: cookiesApi,
  tabs: tabsApi,
  storage: storageApi,
  alarms: alarmsApi,
  runtime: runtimeApi,
};

const ctx = vm.createContext({
  Date,
  URL,
  Promise,
  Set,
  Map,
  console,
  setTimeout,
  clearTimeout,
  chrome: chromeStub,
  self: {},
});
ctx.self = ctx;

function load(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  vm.runInContext(code, ctx, { filename: rel });
}

load("chrome-extension/psl.js");
load("chrome-extension/cookie-database.js");
load("chrome-extension/scoper.js");
load("chrome-extension/scoper-sweep.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const yearsOut = (n) => NOW_SEC + n * 365 * SEC_PER_DAY;
const daysOut = (n) => NOW_SEC + n * SEC_PER_DAY;

const fixtures = [
  // 1. 3p tracker multi-year -> session
  {
    label: "3p scorecardresearch XID (2y) -> session",
    cookie: { name: "XID", value: "abc", domain: ".scorecardresearch.com", path: "/", secure: true, httpOnly: false, sameSite: "no_restriction", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: true, exists: true },
  },
  // 2. 1p first-party multi-year -> 7d
  {
    label: "1p .cnn.com unknown 2y -> 7d cap",
    cookie: { name: "unknown_pref", value: "x", domain: ".cnn.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: false, expirationDateApprox: daysOut(7) },
  },
  // 3. 1p marketing/analytics tracker -> session (OCD demotion)
  {
    label: "1p .cnn.com _ga (Analytics) -> session",
    cookie: { name: "_ga", value: "GA1.2.x.y", domain: ".cnn.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: true, exists: true },
  },
  // 4. Already session -> skip
  {
    label: "1p .cnn.com session cookie -> unchanged",
    cookie: { name: "session_only", value: "x", domain: ".cnn.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: true, storeId: "0" },
    expect: { session: true, unchanged: true },
  },
  // 5. Already within cap -> skip
  {
    label: "1p .cnn.com 3d expiry -> within cap, unchanged",
    cookie: { name: "short_lived", value: "x", domain: ".cnn.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: daysOut(3), storeId: "0" },
    expect: { session: false, unchanged: true, expirationDateApprox: daysOut(3) },
  },
  // 6. Unparseable single-label domain -> skip
  //    (single-label hostnames like `localhost` have no eTLD+1.)
  {
    label: "localhost cookie -> unparseable, unchanged",
    cookie: { name: "dev", value: "x", domain: "localhost", path: "/", secure: false, httpOnly: false, sameSite: "lax", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: false, unchanged: true, expirationDateApprox: yearsOut(2) },
  },
  // 7. __Host- valid -> rewrite to 7d, host-bound
  {
    label: "__Host- valid 1p -> 7d, hostOnly",
    cookie: { name: "__Host-session", value: "x", domain: "www.cnn.com", path: "/", secure: true, httpOnly: true, sameSite: "lax", session: false, expirationDate: yearsOut(2), hostOnly: true, storeId: "0" },
    expect: { session: false, expirationDateApprox: daysOut(7), hostOnly: true },
  },
  // 8. __Host- malformed (leading dot) -> buildSetDetails returns null, skip
  {
    label: "__Host- malformed leading dot -> skipped",
    cookie: { name: "__Host-bad", value: "x", domain: ".cnn.com", path: "/", secure: true, httpOnly: true, sameSite: "lax", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: false, unchanged: true, expirationDateApprox: yearsOut(2) },
  },
  // 9. 3p deep multi-year tracker -> session
  {
    label: "3p .doubleclick.net IDE 2y -> session",
    cookie: { name: "IDE", value: "x", domain: ".doubleclick.net", path: "/", secure: true, httpOnly: true, sameSite: "no_restriction", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: true, exists: true },
  },
  // 10. 1p on a tab we have open but that's NOT cnn -> still 1p (google.com)
  {
    label: "1p .google.com unknown 2y -> 7d cap",
    cookie: { name: "pref_x", value: "x", domain: ".google.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: yearsOut(2), storeId: "0" },
    expect: { session: false, expirationDateApprox: daysOut(7) },
  },
];

// ---------------------------------------------------------------------------
// Run sweep
// ---------------------------------------------------------------------------

(async () => {
  // Settle module load (listener registration) before the first phase.
  await new Promise((r) => setTimeout(r, 10));

  let passed = 0;
  let failed = 0;
  const fail = (label, msg) => { failed++; console.log("  FAIL  " + label + "\n        " + msg); };
  const pass = (label) => { passed++; console.log("  PASS  " + label); };

  // -------------------------------------------------------------------------
  // Phase A: gate-trip — empty seenSites + zero open tabs -> auto sweep skips
  // Manual triggers (popup button) intentionally bypass the gate, so test
  // with "alarm" which is the cron-driven path the gate is meant to guard.
  // -------------------------------------------------------------------------
  openTabs = [];
  // localStorage already empty -> seenSites = []
  const gateRun = await ctx.initialSweep("alarm");
  if (gateRun && gateRun.gated === true && gateRun.rewrites === 0) {
    pass("gate trips on cold start auto-sweep (seenSites < 10, trigger=alarm)");
  } else {
    fail("gate trips on cold start auto-sweep (seenSites < 10, trigger=alarm)", "expected {gated:true,rewrites:0}; got " + JSON.stringify(gateRun));
  }
  // And confirm manual bypasses the gate on the same empty state.
  // (Reset dedup so the next 'alarm' in another test wouldn't be blocked.)
  sessionStorage.clear();
  const manualBypass = await ctx.initialSweep("manual");
  if (manualBypass && manualBypass.gated !== true) {
    pass("manual bypasses gate (trigger=manual, sees " + (manualBypass.scanned || 0) + " cookies)");
  } else {
    fail("manual bypasses gate", "expected non-gated run; got " + JSON.stringify(manualBypass));
  }

  // -------------------------------------------------------------------------
  // Phase B: seenSitesAdd via simulated chrome.tabs.onUpdated
  // -------------------------------------------------------------------------
  if (onTabsUpdatedListeners.length !== 1) {
    fail("tabs.onUpdated registered once", "got " + onTabsUpdatedListeners.length + " listeners");
  } else {
    const handler = onTabsUpdatedListeners[0];
    handler(1, { status: "complete" }, { url: "https://www.cnn.com/" });
    handler(2, { status: "complete" }, { url: "https://news.bbc.co.uk/" });
    handler(3, { status: "loading" }, { url: "https://www.ignored.com/" });   // not complete
    handler(4, { status: "complete" }, { url: "chrome://newtab" });            // unparseable etld+1
    // Let the async seenSitesAdd writes drain.
    await new Promise((r) => setTimeout(r, 10));
    const seen = await ctx.seenSitesGet();
    const want = new Set(["cnn.com", "bbc.co.uk"]);
    const got = new Set(seen);
    const same = got.size === want.size && [...want].every((v) => got.has(v));
    if (same) {
      pass("seenSitesAdd via tabs.onUpdated (cnn.com + bbc.co.uk)");
    } else {
      fail("seenSitesAdd via tabs.onUpdated", "want " + JSON.stringify([...want]) + " got " + JSON.stringify([...got]));
    }
  }

  // -------------------------------------------------------------------------
  // Phase C: real sweep — populate seenSites past gate, seed fixtures
  // -------------------------------------------------------------------------
  // Pad seenSites to >= 10 sites so the gate opens. Use the public
  // seenSitesAdd API so the in-memory cache + storage stay in sync.
  // (Phase B already added cnn.com + bbc.co.uk.)
  const padSites = [
    "google.com", "nytimes.com", "github.com", "wikipedia.org",
    "stackoverflow.com", "reddit.com", "amazon.com", "mozilla.org",
  ];
  await Promise.all(padSites.map((host) => ctx.seenSitesAdd(host)));
  openTabs = [
    { url: "https://www.cnn.com/", status: "complete" },
    { url: "https://www.google.com/", status: "complete" },
  ];

  // Seed cookie fixtures.
  for (const f of fixtures) {
    cookieStore.set(cookieKey(f.cookie), { ...f.cookie });
  }
  const originalCount = cookieStore.size;

  // Pass 1: real work. Expect rewrites + demotions > 0.
  const pass1 = await ctx.initialSweep("manual");
  // Pass 2: idempotency. Expect rewrites == 0.
  const pass2 = await ctx.initialSweep("manual");

  for (const f of fixtures) {
    const key = cookieKey(f.cookie);
    const after = cookieStore.get(key);
    if (!after) {
      // Key changed (e.g. __Host- went from .cnn.com to cnn.com on rewrite).
      // Fall back to a name+path lookup.
      const candidates = [...cookieStore.values()].filter((c) => c.name === f.cookie.name && c.path === f.cookie.path);
      if (candidates.length !== 1) {
        fail(f.label, "expected cookie missing post-sweep (key=" + key + ", candidates=" + candidates.length + ")");
        continue;
      }
    }
    const c = after || [...cookieStore.values()].find((x) => x.name === f.cookie.name && x.path === f.cookie.path);
    const e = f.expect;

    if (e.session !== undefined && !!c.session !== e.session) {
      fail(f.label, "session got=" + !!c.session + " want=" + e.session);
      continue;
    }
    if (e.expirationDateApprox !== undefined) {
      if (c.session) {
        fail(f.label, "expected expirationDate~=" + e.expirationDateApprox + " but cookie is session");
        continue;
      }
      const delta = Math.abs((c.expirationDate || 0) - e.expirationDateApprox);
      if (delta > 60) {
        fail(f.label, "expirationDate got=" + c.expirationDate + " want~=" + e.expirationDateApprox + " delta=" + delta + "s");
        continue;
      }
    }
    if (e.hostOnly !== undefined && !!c.hostOnly !== e.hostOnly) {
      fail(f.label, "hostOnly got=" + !!c.hostOnly + " want=" + e.hostOnly);
      continue;
    }
    if (e.unchanged) {
      // For session-true 'unchanged' cases, expirationDate is absent on
      // both sides — check via session flag only (already covered above).
      // For non-session unchanged, expirationDateApprox above guards it.
    }
    pass(f.label);
  }

  // ---- Sweep-level assertions: pass-1 work + pass-2 idempotency --------
  if (!pass1 || pass1.rewrites + pass1.demotions === 0) {
    fail("pass-1 did real work", "expected rewrites+demotions > 0; got " + JSON.stringify(pass1));
  } else {
    pass("pass-1 did real work (rewrites=" + pass1.rewrites + " demotions=" + pass1.demotions + ")");
  }
  if (!pass2 || pass2.rewrites !== 0 || pass2.demotions !== 0) {
    fail("pass-2 idempotency (rewrites=0, demotions=0)", "got " + JSON.stringify(pass2));
  } else {
    pass("pass-2 idempotency (re-sweep skips everything)");
  }

  // ---- Lifetime stats counter ------------------------------------------
  const { scoperStats } = await chromeStub.storage.local.get("scoperStats");
  const wantRewrites = pass1.rewrites + pass2.rewrites;  // pass2 is 0; total still equals pass1.rewrites
  const wantDemotions = pass1.demotions + pass2.demotions;
  if (!scoperStats) {
    fail("scoperStats written to storage.local", "scoperStats undefined");
  } else if (scoperStats.rewrites !== wantRewrites || scoperStats.demotions !== wantDemotions) {
    fail("scoperStats accumulates rewrites+demotions", "want {rewrites:" + wantRewrites + ",demotions:" + wantDemotions + "} got " + JSON.stringify(scoperStats));
  } else if (typeof scoperStats.lastSweepAt !== "number" || Date.now() - scoperStats.lastSweepAt > 5000) {
    fail("scoperStats.lastSweepAt is recent", "got " + scoperStats.lastSweepAt);
  } else {
    pass("scoperStats {rewrites:" + scoperStats.rewrites + ", demotions:" + scoperStats.demotions + ", lastSweepAt:recent}");
  }

  // ---- Per-site stats bucket -------------------------------------------
  // Fixtures hit .cnn.com (rewrites + 1 demotion), .google.com (rewrite),
  // .doubleclick.net (rewrite, 3p), .scorecardresearch.com (rewrite, 3p).
  // www.cnn.com __Host- valid case rewrites under cnn.com too.
  const bySite = scoperStats && scoperStats.bySite;
  if (!bySite || !bySite["cnn.com"]) {
    fail("scoperStats.bySite[cnn.com] populated", "got " + JSON.stringify(bySite));
  } else if (bySite["cnn.com"].rewrites < 2 || bySite["cnn.com"].demotions < 1) {
    fail("scoperStats.bySite[cnn.com] has rewrites>=2 + demotions>=1", "got " + JSON.stringify(bySite["cnn.com"]));
  } else {
    pass("scoperStats.bySite[cnn.com] = " + JSON.stringify(bySite["cnn.com"]));
  }

  // ---- Sweep history ring buffer ---------------------------------------
  const { scoperHistory } = await chromeStub.storage.local.get("scoperHistory");
  if (!Array.isArray(scoperHistory) || scoperHistory.length < 2) {
    fail("scoperHistory has multiple entries", "got " + JSON.stringify(scoperHistory));
  } else {
    const latest = scoperHistory[0];
    if (typeof latest.at !== "number" || typeof latest.scanned !== "number" || typeof latest.trigger !== "string") {
      fail("scoperHistory entry shape", "got " + JSON.stringify(latest));
    } else {
      pass("scoperHistory ring buffer (length=" + scoperHistory.length + ", latest.trigger=" + latest.trigger + ")");
    }
  }

  // ---- Settings + alarm period ----------------------------------------
  // Default: no scoperSettings => getAlarmPeriod returns default (60).
  // Set 240 => ensureAlarm uses 240. Bad value (3) => falls back to default.
  await chromeStub.storage.local.set({ scoperSettings: { alarmPeriodMin: 240 } });
  alarms.clear();
  await ctx.ensureAlarm();
  const a240 = alarms.get("scoper-sweep");
  if (!a240 || a240.periodInMinutes !== 240) {
    fail("ensureAlarm picks up scoperSettings.alarmPeriodMin=240", "got " + JSON.stringify(a240));
  } else {
    pass("ensureAlarm reads scoperSettings.alarmPeriodMin=240");
  }
  await chromeStub.storage.local.set({ scoperSettings: { alarmPeriodMin: 3 } }); // invalid
  alarms.clear();
  await ctx.ensureAlarm();
  const aFallback = alarms.get("scoper-sweep");
  if (!aFallback || aFallback.periodInMinutes !== 60) {
    fail("ensureAlarm falls back to default for invalid period", "got " + JSON.stringify(aFallback));
  } else {
    pass("ensureAlarm falls back to default (60) for invalid period");
  }

  // -------------------------------------------------------------------------
  // Phase D: trust list — popup-set scoperTrust shifts the cap to 30/90d
  // -------------------------------------------------------------------------
  await chromeStub.storage.local.set({ scoperTrust: { "cnn.com": { capDays: 30, addedAt: Date.now() } } });
  const trustCookie = {
    name: "fresh_pref", value: "x", domain: ".cnn.com", path: "/",
    secure: true, httpOnly: false, sameSite: "lax",
    session: false, expirationDate: yearsOut(2), storeId: "0",
  };
  cookieStore.set(cookieKey(trustCookie), { ...trustCookie });
  await ctx.initialSweep("manual");
  const trusted = cookieStore.get(cookieKey(trustCookie))
    || [...cookieStore.values()].find((c) => c.name === "fresh_pref");
  const wantTrustedExpiry = daysOut(30);
  const trustDelta = Math.abs((trusted.expirationDate || 0) - wantTrustedExpiry);
  if (trustDelta > 60) {
    fail("trust list 30d cap on cnn.com", "want expirationDate~=" + wantTrustedExpiry + " got " + trusted.expirationDate + " delta=" + trustDelta + "s");
  } else {
    pass("trust list 30d cap on cnn.com (fresh cookie capped to 30d, not 7d)");
  }

  console.log("\n" + passed + " passed, " + failed + " failed (" + originalCount + " cookies seeded, " + cookieStore.size + " in store post-sweep)");
  process.exit(failed === 0 ? 0 : 1);
})();
