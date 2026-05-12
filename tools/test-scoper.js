#!/usr/bin/env node
"use strict";

// test-scoper.js — vanilla Node isolation check for scoper.js.
//
// Shims `self` as the Node global, loads psl.js + scoper.js via vm,
// then asserts a small set of representative cases. Not a full test
// suite — just enough to verify the policy works against real PSL data
// before plugging into the chrome.cookies.onChanged listener.
//
// Run: node tools/test-scoper.js
// Exit 0 = all pass; exit 1 = any fail.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ Date, self: {}, console });
ctx.self = ctx;

function load(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  vm.runInContext(code, ctx, { filename: rel });
}

load("chrome-extension/psl.js");
load("chrome-extension/scoper.js");

const { etld1Of, isThirdParty, decideAction, CAP_FIRST_PARTY_DAYS, CAP_TRUSTED_DEFAULT_DAYS, CAP_TRUSTED_POWER_DAYS } = ctx.scoperPolicy;

let passed = 0;
let failed = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    passed++;
    console.log("  PASS  " + label);
  } else {
    failed++;
    console.log("  FAIL  " + label + "\n        got:  " + JSON.stringify(got) + "\n        want: " + JSON.stringify(want));
  }
}

console.log("etld1Of");
eq("www.google.com", etld1Of("www.google.com"), "google.com");
eq("google.com", etld1Of("google.com"), "google.com");
eq("shop.example.co.uk", etld1Of("shop.example.co.uk"), "example.co.uk");
eq("example.co.uk", etld1Of("example.co.uk"), "example.co.uk");
eq("co.uk (TLD only)", etld1Of("co.uk"), null);
eq("a.b.c.example.uk", etld1Of("a.b.c.example.uk"), "example.uk");
eq("leading dot .cnn.com", etld1Of(".cnn.com"), "cnn.com");
eq("uppercase WWW.CNN.COM", etld1Of("WWW.CNN.COM"), "cnn.com");
eq("single label localhost", etld1Of("localhost"), null);
eq("empty string", etld1Of(""), null);
eq("null", etld1Of(null), null);
eq("foo.city.kawasaki.jp (exception)", etld1Of("foo.city.kawasaki.jp"), "city.kawasaki.jp");
eq("user.github.io (wildcard private)", etld1Of("user.github.io"), "user.github.io");
eq("foo.user.github.io", etld1Of("foo.user.github.io"), "user.github.io");

console.log("\nisThirdParty");
eq("cnn.com vs www.cnn.com", isThirdParty("www.cnn.com", "cnn.com"), false);
eq("ads.doubleclick.net vs cnn.com", isThirdParty("ads.doubleclick.net", "cnn.com"), true);
eq(".cnn.com cookie on cnn.com page", isThirdParty(".cnn.com", "cnn.com"), false);
eq("a.github.io vs b.github.io (private wildcard)", isThirdParty("a.github.io", "b.github.io"), true);
eq("missing top -> 1p fallback", isThirdParty("cnn.com", null), false);

console.log("\ndecideAction");
const nowSec = Math.floor(Date.now() / 1000);
const dayFromNow = (d) => nowSec + d * 86400;

eq(
  "1p untrusted long expiry -> rewrite 7d",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    trustList: new Map(),
  }),
  { action: "rewrite", capDays: 7, reason: "first-party-7d", etld1: "cnn.com" },
);

eq(
  "1p untrusted short expiry (3d) -> skip already-within-cap",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(3) },
    topHost: "cnn.com",
    trustList: new Map(),
  }),
  { action: "skip", capDays: 7, reason: "already-within-cap", etld1: "cnn.com" },
);

eq(
  "3p long expiry -> rewrite session",
  decideAction({
    cookie: { domain: ".doubleclick.net", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    trustList: new Map(),
  }),
  { action: "rewrite", capDays: null, reason: "third-party-to-session", etld1: "doubleclick.net" },
);

eq(
  "session cookie -> skip already-session",
  decideAction({
    cookie: { domain: "cnn.com", session: true, expirationDate: 0 },
    topHost: "cnn.com",
    trustList: new Map(),
  }),
  { action: "skip", capDays: null, reason: "already-session", etld1: "cnn.com" },
);

eq(
  "1p trusted 30d long expiry -> rewrite 30d",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    trustList: new Map([["cnn.com", { capDays: 30 }]]),
  }),
  { action: "rewrite", capDays: 30, reason: "trusted-30d", etld1: "cnn.com" },
);

eq(
  "1p trusted 90d long expiry -> rewrite 90d",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    trustList: new Map([["cnn.com", { capDays: 90 }]]),
  }),
  { action: "rewrite", capDays: 90, reason: "trusted-90d", etld1: "cnn.com" },
);

eq(
  "1p trust does NOT apply to 3p on trusted site",
  decideAction({
    cookie: { domain: ".doubleclick.net", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    trustList: new Map([["cnn.com", { capDays: 90 }]]),
  }),
  { action: "rewrite", capDays: null, reason: "third-party-to-session", etld1: "doubleclick.net" },
);

eq(
  "1p Marketing-named cookie -> session (tracker demotion)",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map(),
    cookieClass: { category: "Marketing", vendor: "DoubleClick/Google Marketing" },
  }),
  { action: "rewrite", capDays: null, reason: "first-party-tracker-to-session", etld1: "cnn.com", vendor: "DoubleClick/Google Marketing" },
);

eq(
  "1p Analytics-named cookie -> session (tracker demotion)",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map(),
    cookieClass: { category: "Analytics", vendor: "ABTasty" },
  }),
  { action: "rewrite", capDays: null, reason: "first-party-tracker-to-session", etld1: "cnn.com", vendor: "ABTasty" },
);

eq(
  "1p Functional-named cookie -> 7d (NOT demoted)",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map(),
    cookieClass: { category: "Functional", vendor: "OneTrust" },
  }),
  { action: "rewrite", capDays: 7, reason: "first-party-7d", etld1: "cnn.com" },
);

eq(
  "1p Security-named cookie -> 7d (NOT demoted; e.g. __eoi)",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map(),
    cookieClass: { category: "Security", vendor: "Google AdSense" },
  }),
  { action: "rewrite", capDays: 7, reason: "first-party-7d", etld1: "cnn.com" },
);

eq(
  "trust does NOT extend to known tracker -> session",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map([["cnn.com", { capDays: 90 }]]),
    cookieClass: { category: "Marketing", vendor: "Quantcast" },
  }),
  { action: "rewrite", capDays: null, reason: "first-party-tracker-to-session", etld1: "cnn.com", vendor: "Quantcast" },
);

eq(
  "trust DOES extend to Functional cookie on trusted site",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map([["cnn.com", { capDays: 30 }]]),
    cookieClass: { category: "Functional", vendor: "OneTrust" },
  }),
  { action: "rewrite", capDays: 30, reason: "trusted-30d", etld1: "cnn.com" },
);

eq(
  "1p unknown name (no OCD entry) -> 7d default",
  decideAction({
    cookie: { domain: ".cnn.com", session: false, expirationDate: dayFromNow(365) },
    thirdParty: false,
    trustList: new Map(),
    cookieClass: null,
  }),
  { action: "rewrite", capDays: 7, reason: "first-party-7d", etld1: "cnn.com" },
);

eq(
  "thirdParty override true -> session (even with matching topHost)",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(365) },
    topHost: "cnn.com",
    thirdParty: true,
    trustList: new Map(),
  }),
  { action: "rewrite", capDays: null, reason: "third-party-to-session", etld1: "cnn.com" },
);

eq(
  "thirdParty override false -> 7d (even with mismatching topHost)",
  decideAction({
    cookie: { domain: "cnn.com", session: false, expirationDate: dayFromNow(365) },
    topHost: "unrelated.example",
    thirdParty: false,
    trustList: new Map(),
  }),
  { action: "rewrite", capDays: 7, reason: "first-party-7d", etld1: "cnn.com" },
);

eq(
  "unparseable domain -> skip",
  decideAction({
    cookie: { domain: "localhost", session: false, expirationDate: dayFromNow(365) },
    topHost: "localhost",
    trustList: new Map(),
  }),
  { action: "skip", capDays: null, reason: "unparseable-domain", etld1: null },
);

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
