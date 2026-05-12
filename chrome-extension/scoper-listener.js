"use strict";

// scoper-listener.js — wires chrome.cookies.onChanged to scoperPolicy.
// Phase 1 v0: empty trust list (added in next commit). Option B for
// 1p/3p classification — check if cookie's eTLD+1 matches ANY currently
// open tab's eTLD+1.

const INFLIGHT_TTL_MS = 5000;
const inflight = new Map();

function stripLeadingDot(d) {
  return d.startsWith(".") ? d.slice(1) : d;
}

function cookieKey(c) {
  return c.name + "|" + stripLeadingDot(c.domain) + "|" + c.path + "|" + (c.storeId || "");
}

async function openTabETLDSet() {
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

async function loadTrustList() {
  // v0: empty. The next commit adds chrome.storage.local-backed trust
  // list with the popup "Trust this site" button.
  return new Map();
}

function buildSetDetails(cookie, capDays) {
  const host = stripLeadingDot(cookie.domain);
  const details = {
    url: (cookie.secure ? "https:" : "http:") + "//" + host + cookie.path,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
  };
  if (capDays !== null) {
    details.expirationDate = Math.floor(Date.now() / 1000) + capDays * 86400;
  }
  if (cookie.name.startsWith("__Host-")) {
    // __Host- spec: Secure + path=/ + no Domain attribute.
    if (cookie.path !== "/" || !cookie.secure || cookie.domain.startsWith(".")) {
      return null;
    }
    // Intentionally no details.domain
  } else if (cookie.domain.startsWith(".")) {
    details.domain = cookie.domain;
  }
  return details;
}

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed) return;
  if (cookie.session) return;

  const policy = self.scoperPolicy;
  const cookieETLD = policy.etld1Of(cookie.domain);
  if (!cookieETLD) return;

  const [openSet, trustList] = await Promise.all([openTabETLDSet(), loadTrustList()]);
  const thirdParty = !openSet.has(cookieETLD);

  const decision = policy.decideAction({ cookie, thirdParty, trustList });
  if (decision.action !== "rewrite") return;

  const key = cookieKey(cookie);
  const seenAt = inflight.get(key);
  if (seenAt && Date.now() - seenAt < INFLIGHT_TTL_MS) return;
  inflight.set(key, Date.now());

  const details = buildSetDetails(cookie, decision.capDays);
  if (!details) {
    console.log("[wearecooked v5 scoper] skip malformed __Host- cookie:", { name: cookie.name, domain: cookie.domain });
    inflight.delete(key);
    return;
  }

  chrome.cookies.set(details, (result) => {
    if (chrome.runtime.lastError || !result) {
      console.warn("[wearecooked v5 scoper] set failed:", chrome.runtime.lastError && chrome.runtime.lastError.message, details);
      inflight.delete(key);
    } else {
      console.log(
        "[wearecooked v5 scoper] " + decision.reason + ":",
        { name: result.name, domain: result.domain, capDays: decision.capDays, session: result.session },
      );
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - INFLIGHT_TTL_MS;
  for (const [k, t] of inflight) if (t < cutoff) inflight.delete(k);
}, 30000);

console.log("[wearecooked v5 scoper] listener loaded (Option B: any-open-tab eTLD+1 match)");
