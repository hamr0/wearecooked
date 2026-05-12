"use strict";

// wearecooked Phase 1 POC — cookie scoper round-trip
// Validates: chrome.cookies.onChanged -> chrome.cookies.set as session cookie
// Scope: single test host (example.com) hardcoded. NOT FOR DISTRIBUTION.

const TEST_HOST = "example.com";
const LONG_LIVED_THRESHOLD_DAYS = 30;

// Belt-and-suspenders against re-trigger loops. cookie.session=true on the
// rewritten event is the primary breaker; this dedupe map catches concurrent
// pathologies.
const inflight = new Map();
const INFLIGHT_TTL_MS = 5000;

function cookieKey(c) {
  const dom = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
  return c.name + "|" + dom + "|" + c.path + "|" + (c.storeId || "");
}

function hostMatches(cookieDomain) {
  const dom = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return dom === TEST_HOST || dom.endsWith("." + TEST_HOST);
}

chrome.cookies.onChanged.addListener(({ cookie, cause, removed }) => {
  if (removed) return;
  if (!hostMatches(cookie.domain)) return;
  if (cookie.session) return;

  const nowSec = Date.now() / 1000;
  const lifeDays = (cookie.expirationDate - nowSec) / 86400;
  if (lifeDays < LONG_LIVED_THRESHOLD_DAYS) return;

  const key = cookieKey(cookie);
  const seenAt = inflight.get(key);
  if (seenAt && Date.now() - seenAt < INFLIGHT_TTL_MS) return;
  inflight.set(key, Date.now());

  const hostNoLeadingDot = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const url = (cookie.secure ? "https:" : "http:") + "//" + hostNoLeadingDot + cookie.path;

  const details = {
    url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
    // expirationDate omitted -> becomes session
  };

  if (cookie.name.startsWith("__Host-")) {
    // __Host- spec: Secure + path=/ + no Domain attribute.
    // If any invariant is off, skip rather than risk Chrome rejection.
    if (cookie.path !== "/" || !cookie.secure || cookie.domain.startsWith(".")) {
      console.log("[POC] skip malformed __Host- cookie:", cookie);
      inflight.delete(key);
      return;
    }
    // No details.domain — required for __Host-.
  } else if (cookie.domain.startsWith(".")) {
    details.domain = cookie.domain; // preserve explicit Domain= attribute
  }

  console.log("[POC] rewriting -> session:", { name: cookie.name, domain: cookie.domain, lifeDays: Math.round(lifeDays) });

  chrome.cookies.set(details, (result) => {
    if (chrome.runtime.lastError || !result) {
      console.warn("[POC] set failed:", chrome.runtime.lastError && chrome.runtime.lastError.message, "details:", details);
    } else {
      console.log("[POC] rewrote ok:", { name: result.name, session: result.session });
    }
  });
});

console.log("[POC] phase1-cookie-scoper loaded; watching", TEST_HOST);
