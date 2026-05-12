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
};

const storageApi = {
  session: {
    get(key) {
      const out = {};
      if (typeof key === "string") {
        if (sessionStorage.has(key)) out[key] = sessionStorage.get(key);
      } else if (Array.isArray(key)) {
        for (const k of key) if (sessionStorage.has(k)) out[k] = sessionStorage.get(k);
      }
      return Promise.resolve(out);
    },
    set(obj) {
      for (const [k, v] of Object.entries(obj)) sessionStorage.set(k, v);
      return Promise.resolve();
    },
  },
};

const runtimeApi = {
  // The sweep registers onInstalled/onStartup handlers at module load —
  // capture them but never auto-fire; tests invoke initialSweep directly.
  onInstalled: { addListener(_fn) { /* no-op */ } },
  onStartup: { addListener(_fn) { /* no-op */ } },
  lastError: null,
};

const chromeStub = {
  cookies: cookiesApi,
  tabs: tabsApi,
  storage: storageApi,
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

// Anchor: any open tab on cnn.com makes .cnn.com first-party for the sweep.
openTabs = [
  { url: "https://www.cnn.com/", status: "complete" },
  { url: "https://www.google.com/", status: "complete" },
];

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
  // Drain the module's top-level `initialSweep("sw-load")` against the
  // *empty* cookie store first, so its run doesn't race with the two
  // manual passes that follow. After this point each manual sweep runs
  // on a known state.
  await new Promise((r) => setTimeout(r, 10));

  // Seed AFTER the sw-load drain so the first real pass sees fresh
  // fixtures, and we can assert non-trivial rewrite counts.
  for (const f of fixtures) {
    cookieStore.set(cookieKey(f.cookie), { ...f.cookie });
  }
  const originalCount = cookieStore.size;

  // Pass 1: real work. Expect rewrites + demotions > 0.
  const pass1 = await ctx.initialSweep("manual");

  // Pass 2: idempotency. Expect rewrites == 0 (everything now within cap
  // or already session). If non-zero, the policy isn't stable across
  // sweeps — the cron design would thrash cookies on every fire.
  const pass2 = await ctx.initialSweep("manual");

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  let passed = 0;
  let failed = 0;
  const fail = (label, msg) => { failed++; console.log("  FAIL  " + label + "\n        " + msg); };
  const pass = (label) => { passed++; console.log("  PASS  " + label); };

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

  console.log("\n" + passed + " passed, " + failed + " failed (" + originalCount + " cookies seeded, " + cookieStore.size + " in store post-sweep)");
  process.exit(failed === 0 ? 0 : 1);
})();
