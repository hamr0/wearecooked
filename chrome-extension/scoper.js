"use strict";

// scoper.js — pure cookie-scoping policy. No Chrome APIs; testable in
// any console that has loaded psl.js first.
//
// Depends on globals from psl.js:
//   self.PSL_NORMAL, self.PSL_WILDCARD, self.PSL_EXCEPTION
//
// Exports (via self.scoperPolicy):
//   etld1Of(host)                            -> string | null
//   isThirdParty(cookieHost, topHost)        -> boolean
//   decideAction({cookie, topHost?, thirdParty?, trustList})
//                                            -> { action, capDays, reason, etld1 }
//
// decideAction can be called two ways:
//   - With topHost: policy computes thirdParty internally (used by tests).
//   - With thirdParty (boolean): caller pre-computed it (used by the
//     listener, which does an "any open tab" Set lookup for Option B).
// thirdParty takes precedence if both are provided.
//
// v5 UX defaults (locked 2026-05-12):
//   first-party untrusted        -> 7 days
//   first-party trusted default  -> 30 days
//   first-party trusted power    -> 90 days
//   third-party (always)         -> session (capDays=null)

const TIER_FIRST_PARTY_DAYS = 7;
const TIER_TRUSTED_DEFAULT_DAYS = 30;
const TIER_TRUSTED_POWER_DAYS = 90;
const SEC_PER_DAY = 86400;

// Mozilla PSL matching algorithm:
//   1. If an exception rule matches a suffix, the public suffix is that
//      suffix without its leftmost label.
//   2. Otherwise the longest matching rule (normal or wildcard `*.x`)
//      determines the public suffix.
//   3. If no rule matches, the public suffix defaults to the rightmost label.
// eTLD+1 = public suffix prefixed by one more label.
function etld1Of(host) {
  if (!host) return null;
  const cleaned = host.startsWith(".") ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return null;

  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    if (self.PSL_EXCEPTION.has(suffix)) {
      const publicSuffixLen = labels.length - i - 1;
      if (publicSuffixLen >= labels.length) return null;
      return labels.slice(labels.length - publicSuffixLen - 1).join(".");
    }
  }

  let publicSuffixLen = 0;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    if (self.PSL_NORMAL.has(suffix)) {
      const len = labels.length - i;
      if (len > publicSuffixLen) publicSuffixLen = len;
    }
    if (i < labels.length - 1) {
      const tail = labels.slice(i + 1).join(".");
      if (self.PSL_WILDCARD.has(tail)) {
        const len = labels.length - i;
        if (len > publicSuffixLen) publicSuffixLen = len;
      }
    }
  }
  if (publicSuffixLen === 0) publicSuffixLen = 1;
  if (publicSuffixLen >= labels.length) return null;
  return labels.slice(labels.length - publicSuffixLen - 1).join(".");
}

function isThirdParty(cookieHost, topHost) {
  const cookieETLD = etld1Of(cookieHost);
  const topETLD = topHost ? etld1Of(topHost) : null;
  if (!cookieETLD || !topETLD) return false;
  return cookieETLD !== topETLD;
}

// Decision priority (top wins):
//   1. unparseable domain                            -> skip
//   2. already session                               -> skip
//   3. third-party (by topHost or thirdParty arg)    -> rewrite session
//   4. 1p AND OCD classifies as Marketing/Analytics  -> rewrite session
//      (trust does not extend to known trackers; same spirit as #3)
//   5. 1p trusted                                    -> rewrite 30d/90d
//   6. 1p untrusted                                  -> rewrite 7d
//   7. result cap >= cookie's remaining life         -> skip already-within-cap
function decideAction({ cookie, topHost, thirdParty, trustList, cookieClass }) {
  const cookieETLD = etld1Of(cookie.domain);
  if (!cookieETLD) {
    return { action: "skip", capDays: null, reason: "unparseable-domain", etld1: null };
  }
  if (cookie.session) {
    return { action: "skip", capDays: null, reason: "already-session", etld1: cookieETLD };
  }

  const tp = thirdParty !== undefined
    ? !!thirdParty
    : (topHost ? isThirdParty(cookie.domain, topHost) : false);

  if (tp) {
    return { action: "rewrite", capDays: null, reason: "third-party-to-session", etld1: cookieETLD };
  }

  if (cookieClass && (cookieClass.category === "Marketing" || cookieClass.category === "Analytics")) {
    return {
      action: "rewrite",
      capDays: null,
      reason: "first-party-tracker-to-session",
      etld1: cookieETLD,
      vendor: cookieClass.vendor,
    };
  }

  const trust = trustList && trustList.get && trustList.get(cookieETLD);
  let capDays;
  let reason;
  if (trust && (trust.capDays === TIER_TRUSTED_DEFAULT_DAYS || trust.capDays === TIER_TRUSTED_POWER_DAYS)) {
    capDays = trust.capDays;
    reason = "trusted-" + capDays + "d";
  } else {
    capDays = TIER_FIRST_PARTY_DAYS;
    reason = "first-party-7d";
  }

  const nowSec = Date.now() / 1000;
  const remainingDays = (cookie.expirationDate - nowSec) / SEC_PER_DAY;
  if (remainingDays <= capDays) {
    return { action: "skip", capDays, reason: "already-within-cap", etld1: cookieETLD };
  }

  return { action: "rewrite", capDays, reason, etld1: cookieETLD };
}

self.scoperPolicy = {
  etld1Of,
  isThirdParty,
  decideAction,
  CAP_FIRST_PARTY_DAYS: TIER_FIRST_PARTY_DAYS,
  CAP_TRUSTED_DEFAULT_DAYS: TIER_TRUSTED_DEFAULT_DAYS,
  CAP_TRUSTED_POWER_DAYS: TIER_TRUSTED_POWER_DAYS,
};
