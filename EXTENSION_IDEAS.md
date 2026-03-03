# Extension Ideas — "weare____" Privacy Series

All local-first, no backend, things big tech won't build.

---

## 1. wearesilent — Form & Keystroke Leak Detector

**What it does.** Detects when websites capture form input values (email, password, credit card) before you click submit. Many sites use session replay tools, Meta Pixel, or custom scripts to exfiltrate keystrokes in real-time for analytics or abandoned cart tracking. Shows: "This site sent your email to analytics.company.com before you clicked submit."

**Why no one has built it.** The only attempt (LeakInspector, KU Leuven 2022) is a dead MV2 proof-of-concept rejected from Chrome Web Store. No published extension does this. A USENIX study found 2,950 of the top 100,000 sites leak form data pre-submit.

**Research:** [Leaky Forms (USENIX 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) | [LeakInspector source](https://github.com/leaky-forms/leak-inspector)

**APIs:** Content scripts (prototype wrapping on HTMLInputElement.value, addEventListener interception), webRequest (observe outgoing POST/beacon), MutationObserver, navigator.sendBeacon interception.

**Permissions:** `webRequest`, `activeTab`, `scripting`, `<all_urls>`

**POC scope:**
- Content script injected into every page that wraps `HTMLInputElement.prototype` value getter and `addEventListener` for `input`, `keyup`, `change`, `blur` events on `<input>` and `<textarea>` elements
- Log every time a script reads a form field value to the console: `[wearesilent] Script read input#email value: "user@example.com"`
- Background script listens on `webRequest.onBeforeRequest` for all outgoing POST requests and `sendBeacon` calls
- For each outgoing request, check if the request body/URL contains any recently-typed form values (raw string match + URL-encoded match)
- If a match is found, log it: `[wearesilent] LEAK DETECTED: value from input#email found in request to analytics.tracker.com`
- Display a red badge count on the extension icon showing number of leaks detected on current tab
- Popup shows a simple list: field name, value leaked, destination domain, timestamp

**What the POC proves:** That you can correlate form field reads with outbound requests in real-time. Does not need hash matching (MD5/SHA), redirect chain analysis, or session replay detection — those come later.

**Difficulty:** High

---

## 2. weareleaking — localStorage / sessionStorage Inspector

**What it does.** Scans every website you visit and shows what data is stored locally on your machine: localStorage keys/values, sessionStorage, IndexedDB databases. Flags suspicious patterns like tracking IDs (UUIDs), base64-encoded blobs, PII-shaped strings (emails), and shows total storage consumed per domain. A "data footprint" meter for your browser.

**Why no one has built it.** DevTools shows this but requires technical knowledge and per-tab manual inspection. No extension aggregates across all sites into a user-friendly dashboard.

**APIs:** Content scripts reading `window.localStorage`, `window.sessionStorage`, `indexedDB.databases()`. `storage` API for scan history.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script injected on every page load that reads all `localStorage` keys/values and `sessionStorage` keys/values for the current origin
- Send results to background script via `runtime.sendMessage`
- Background script stores results keyed by domain in `browser.storage.local`
- Popup page shows a table: domain, number of keys, total size (bytes), list of key names
- Flag keys that look suspicious using simple regex: UUIDs (`/[0-9a-f]{8}-[0-9a-f]{4}/`), anything with "track", "id", "uid", "fbp", "ga", "analytics" in the key name, values that look like emails (`/@/`), base64 blobs (long alphanumeric strings)
- Badge shows count of flagged (suspicious) keys on current tab
- One-page dashboard listing all scanned domains sorted by number of suspicious keys

**What the POC proves:** That scanning localStorage/sessionStorage from a content script works, that there is a surprising amount of tracking data stored locally, and that simple pattern matching catches the obvious stuff.

**Difficulty:** Low

---

## 3. wearewatched — Permission & Sensor Access Monitor

**What it does.** A persistent toolbar icon that lights up whenever a website accesses device capabilities: clipboard, geolocation, camera, microphone, notifications, motion sensors. Logs every access attempt with timestamp and domain. Shows: "reddit.com checked your clipboard 4 times in the last hour."

**Why no one has built it.** Browsers show one-time permission prompts but provide zero ongoing visibility into how often granted permissions are actually used. There is no "access log" anywhere in Chrome or Firefox.

**APIs:** Content scripts wrapping `navigator.clipboard.readText`, `navigator.geolocation.getCurrentPosition`, `navigator.geolocation.watchPosition`, `Notification.requestPermission`, `navigator.mediaDevices.getUserMedia`, `DeviceMotionEvent`, `DeviceOrientationEvent` via prototype interception.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that injects a page-level script (via `<script>` tag into page context) to wrap three APIs as a starting point:
  - `navigator.clipboard.readText` / `navigator.clipboard.read`
  - `navigator.geolocation.getCurrentPosition` / `watchPosition`
  - `Notification.requestPermission`
- Each wrapper: calls the original function, then posts a `CustomEvent` or `window.postMessage` back to the content script with: API name, timestamp, page URL
- Content script forwards events to background script
- Background script stores access log in `browser.storage.local` keyed by domain
- Popup shows a reverse-chronological log: "clipboard read — reddit.com — 2 min ago"
- Badge shows total access count for current tab

**What the POC proves:** That prototype wrapping works for permission APIs, that sites access these more often than users expect, and that the access log UX is useful.

**Difficulty:** Medium

---

## 4. wearetracked — Fingerprint Exposure Dashboard

**What it does.** Shows users in real-time exactly how uniquely identifiable they are. Monitors every fingerprinting technique the current page attempts — canvas, WebGL, AudioContext, font enumeration, navigator property reads — and presents a dashboard: "This site tried 7 fingerprinting methods." Unlike existing tools that block or spoof fingerprints, this is purely observational and educational.

**Why no one has built it.** Existing fingerprint tools (Canvas Blocker, Chameleon) focus on blocking/spoofing, which breaks sites. The pure transparency angle — just showing what is being attempted — has no commercial model. DFPM on GitHub tried this but is abandoned and developer-focused.

**APIs:** Content scripts with `Object.defineProperty` wrappers on Canvas (`toDataURL`, `getImageData`), WebGL (`getParameter`, `getExtension`), AudioContext (`createOscillator`), navigator properties (`hardwareConcurrency`, `deviceMemory`, `platform`, `languages`).

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that injects a page-level script wrapping the most common fingerprinting APIs (start with 5):
  - `HTMLCanvasElement.prototype.toDataURL`
  - `WebGLRenderingContext.prototype.getParameter`
  - `AudioContext.prototype.createOscillator` (or `OfflineAudioContext`)
  - `navigator.hardwareConcurrency` (getter)
  - `navigator.languages` (getter)
- Each wrapper: calls the original, posts a message to the content script with: API name, call stack (first 3 frames via `new Error().stack`), timestamp
- Content script forwards to background script
- Background script tallies fingerprinting attempts per domain
- Popup shows: domain, list of fingerprinting methods attempted, total count
- Badge shows number of distinct fingerprinting techniques detected on current tab (e.g., "4")

**What the POC proves:** That wrapping fingerprinting APIs catches real-world usage, and that the count of techniques per page is surprisingly high and varies meaningfully across sites.

**Difficulty:** Medium

---

## 5. wearecounted — Hidden Tracking Pixel & Beacon Visualizer

**What it does.** Identifies and counts tracking pixels, invisible iframes, and beacon API calls — the invisible infrastructure of surveillance. Makes the invisible visible. Shows an overlay: "This page contains 14 hidden tracking pixels, 3 invisible iframes, and 2 beacon API calls" with the ability to highlight them in the DOM.

**Why no one has built it.** Tracker blockers silently remove these elements so users never learn how pervasive they are. The educational/transparency angle — showing rather than blocking — has no commercial model.

**APIs:** Content scripts scanning for `<img>` elements with 1x1 dimensions or `display:none`, zero-size `<iframe>` elements, `navigator.sendBeacon()` calls (prototype interception), `<link rel="prefetch">` abuse. MutationObserver for dynamically injected pixels.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that runs on `document_idle` and scans the DOM for:
  - `<img>` elements where `naturalWidth <= 1` or `naturalHeight <= 1` or `display:none` or `visibility:hidden`
  - `<iframe>` elements where `width <= 1` or `height <= 1` or `display:none`
  - `<link rel="prefetch">` elements pointing to known tracker domains
- Also inject a page-level script that wraps `navigator.sendBeacon` to count beacon calls
- MutationObserver watches for new elements matching the above criteria (trackers often inject after page load)
- Content script counts totals and sends to background script
- Badge shows total hidden element count
- Popup shows breakdown: "8 tracking pixels, 2 hidden iframes, 4 beacon calls" with a list of destination domains
- Optional: clicking "Highlight" in popup sends a message to content script which outlines all hidden elements with a red border (`element.style.outline = '3px solid red'`) making them visible on the page

**What the POC proves:** That invisible tracking infrastructure exists on virtually every major website, and that making it visible is striking enough to be valuable on its own.

**Difficulty:** Low

---

## 6. wearedark — Dark Pattern Scorecard

**What it does.** Assigns every website a manipulation score (0-100) based on dark patterns detected: countdown timers, pre-checked consent boxes, hidden unsubscribe flows, confirm-shaming language ("No thanks, I don't want to save money"), fake urgency ("Only 2 left!"), trick questions in opt-outs. Badge shows green/yellow/red per site. Results build up a personal "worst offenders" list.

**Why no one has built it.** Existing detectors (Pattern Shield, Dark Pattern Detector) use ML models that are slow and inaccurate. A lightweight heuristic approach with cumulative scoring is the missing middle ground.

**APIs:** Content scripts with DOM analysis, MutationObserver, CSS selector matching. `storage` for score history.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that runs on `document_idle` and checks for 5 common dark patterns using DOM/text analysis:
  1. **Countdown timers** — scan for elements with `setInterval`/`setTimeout` that contain time-like text (regex for `\d+:\d+:\d+` or "hours", "minutes", "seconds left")
  2. **Pre-checked checkboxes** — find `<input type="checkbox" checked>` inside forms, especially near text containing "newsletter", "marketing", "subscribe", "agree"
  3. **Confirm-shaming** — scan button/link text for negative-option patterns: "No thanks", "I don't want", "I'll pass on", "No, I prefer" (bundled phrase list)
  4. **Fake urgency** — scan visible text for "Only X left", "X people viewing", "Limited time", "Hurry", "Act now" (bundled phrase list)
  5. **Hidden unsubscribe** — scan for links/text containing "unsubscribe" and check if font-size < 10px or color contrast ratio < 2:1 against background
- Score each detected pattern (0-20 points each), sum for total page score (0-100)
- Send score + detected patterns to background script
- Badge shows color: green (0-30), yellow (31-60), red (61-100)
- Popup shows: site score, list of detected patterns with descriptions

**What the POC proves:** That simple heuristics catch the most common dark patterns reliably enough to be useful, without needing ML.

**Difficulty:** Medium

---

## 7. wearelinked — Redirect & Link Washing Exposer

**What it does.** Before you click any link, hover to see where it actually goes. Shows the full redirect chain — revealing when a "clean" link actually bounces through tracking redirects. Strips UTM parameters, fbclid, gclid, and other tracking decorations. Shows: "This link goes through: google.com/url → t.co → bit.ly → actual-site.com (3 tracking hops removed)."

**Why no one has built it.** ClearURLs handles parameter stripping. Link Redirect Trace is SEO-focused. No tool combines hover-preview, redirect chain visualization, and parameter cleaning into one simple UX. Google, Facebook, and Twitter all use link-washing to track outbound clicks.

**APIs:** Content scripts with `mouseover` event listeners. `webRequest` for redirect chain inspection. URL parsing (local string operations). Optional `clipboardWrite` for clean URL copy.

**Permissions:** `webRequest`, `activeTab`, `<all_urls>`

**POC scope:**
- Content script that adds a `mouseover` listener to all `<a>` elements
- On hover, parse the `href` and check if it's a known redirect wrapper:
  - `google.com/url?q=` — extract the `q` parameter
  - `l.facebook.com/l.php?u=` — extract the `u` parameter
  - `t.co/*` — flag as Twitter redirect (actual destination requires following the redirect)
  - `bit.ly/*`, `tinyurl.com/*` — flag as URL shortener
  - Any URL with `utm_source`, `utm_medium`, `fbclid`, `gclid`, `mc_eid` parameters — strip them
- Show a small tooltip near the link with: original URL, cleaned URL (parameters stripped), and flags for known redirect wrappers
- Background script uses `webRequest.onBeforeRedirect` to follow actual redirect chains when a user clicks a link, storing the full chain
- Popup shows recent click history: original link → full chain → final destination
- Badge shows count of tracking parameters stripped on current page

**What the POC proves:** That most pages contain links with tracking parameters, that redirect wrappers are ubiquitous, and that a hover tooltip showing the real destination is immediately useful.

**Difficulty:** Low–Medium

---

## 8. weareexpired — Privacy Policy Change Monitor

**What it does.** Saves a local snapshot of the privacy policy/ToS for every site you visit. When you return and the text has changed, shows a diff: what was added, removed, and what matters. Highlights changes that affect you: new data sharing clauses, expanded tracking scope, reduced user rights. Badge: "Privacy policy changed since your last visit. 3 concerning changes detected."

**Why no one has built it.** ToS;DR rates policies but doesn't track changes over time. The gap is personal, longitudinal monitoring — "what changed since I last agreed?" Doing it locally means no infrastructure costs and no privacy concerns.

**APIs:** Content scripts to detect and extract privacy policy content (heuristic URL matching: */privacy*, */terms*, */tos*). `storage` for snapshots. Text diffing in pure JS.

**Permissions:** `activeTab`, `storage`, `alarms` (for periodic checks)

**POC scope:**
- Content script that checks if the current URL matches common privacy policy patterns: `/privacy`, `/terms`, `/tos`, `/legal`, `/cookie-policy` (regex on `window.location.pathname`)
- If matched, extract the main text content: `document.body.innerText` or target `<main>`/`<article>` if present, strip navigation/footer boilerplate
- Hash the text content (simple string hash or first 10,000 chars) and send to background script with domain + full text
- Background script stores in `browser.storage.local`: `{ domain: { hash, text, lastChecked, url } }`
- On subsequent visits to the same domain's policy page: compare new hash to stored hash
- If changed, compute a simple line-by-line diff (split by `\n`, find added/removed lines)
- Send diff summary to popup
- Badge shows "!" on domains where policy changed since last visit
- Popup shows: domain, last checked date, "Changed" / "No change", and if changed: count of added/removed lines with a scrollable diff view (green for added, red for removed)

**What the POC proves:** That privacy policies change more often than users expect, that a simple text diff is sufficient to catch meaningful changes, and that the local snapshot approach works without any backend.

**Difficulty:** Medium

---

## 9. wearesold — Data Broker Link Detector

**What it does.** Maintains a bundled list of known data broker domains (compiled from public sources: EFF, disconnect list, state data broker registries). As you browse, highlights when a page communicates with known data brokers — not just ad trackers, but companies that buy and sell personal information. Shows: "This page shared data with 3 known data brokers: Acxiom, Oracle Data Cloud, LiveRamp."

**Why no one has built it.** Existing tools lump everything as "trackers" with no distinction between an analytics pixel and a data broker that literally sells your profile. No extension specifically names the data economy players in plain language.

**APIs:** `webRequest` to monitor outbound requests. Bundled JSON domain list. `storage` for history.

**Permissions:** `webRequest`, `<all_urls>`, `storage`

**POC scope:**
- Compile a bundled JSON list of known data broker domains (start with ~50-100 from public sources):
  - Data brokers: Acxiom, Oracle Data Cloud (BlueKai), LiveRamp, Lotame, Epsilon, Experian Marketing, TransUnion, Equifax, LexisNexis, Spokeo, BeenVerified, Whitepages, PeopleFinder
  - Data marketplaces: Bombora, Eyeota, Intent IQ, Zeotap, Tapad, Drawbridge, Crosswise
  - Format: `{ "domain": "acxiom.com", "name": "Acxiom", "type": "Data Broker", "description": "Consumer data aggregator" }`
- Background script listens on `webRequest.onCompleted` for all requests
- Check each request domain against the bundled list (root domain match)
- Store matches per tab: `{ tabId: [{ broker, domain, url, timestamp }] }`
- Badge shows count of data broker connections on current tab
- Popup shows: "This page connected to X data brokers" with a list: broker name, what they do (one-line description), number of requests

**What the POC proves:** That data broker connections are common on mainstream websites, and that naming the specific companies (not just "tracker") is more impactful for user understanding.

**Difficulty:** Low

---

## 10. weareopen — Third-Party Script Audit Dashboard

**What it does.** For every page you visit, itemizes every third-party script loaded: origin, size, category (analytics, advertising, social, payment, CDN). Shows a "page cost" breakdown: "This page loaded 47 third-party scripts from 23 companies, totaling 2.1MB."

**Why no one has built it.** Mozilla's Lightbeam is discontinued. Ghostery is commercial and focused on blocking. No tool gives a detailed, per-page breakdown that a non-technical user can understand.

**APIs:** `webRequest` to intercept script loads. `PerformanceObserver` / `performance.getEntriesByType('resource')` for size/timing. Bundled categorization list.

**Permissions:** `webRequest`, `<all_urls>`, `storage`

**POC scope:**
- Background script listens on `webRequest.onCompleted` filtering for `types: ["script"]`
- For each script request, extract domain and check if it's third-party (different root domain from tab URL)
- Categorize using a bundled domain list (reuse tracker lists from wearebaked — Advertising, Analytics, Social, CDN, etc.)
- Track per tab: `{ tabId: [{ domain, url, category, size (from Content-Length header), responseTime }] }`
- Content script uses `performance.getEntriesByType('resource')` to get accurate transfer sizes for scripts and sends to background
- Badge shows count of third-party scripts on current tab
- Popup shows summary: total scripts, third-party count, total size, and a categorized list
- Simple bar chart (CSS only, no library) showing breakdown by category

**What the POC proves:** That the number and size of third-party scripts on typical websites is shocking, and that categorizing them makes the data meaningful to non-technical users.

**Difficulty:** Medium

---

## Summary

| # | Extension | What it does | Status | Repo |
|---|-----------|-------------|--------|------|
| 1 | wearecooked | Shows which cookies websites drop on you | SHIPPED | [hamr0/wearecooked](https://github.com/hamr0/wearecooked) |
| 2 | wearebaked | Detects third-party tracking requests on every page | SHIPPED | [hamr0/wearebaked](https://github.com/hamr0/wearebaked) |
| 3 | weareleaking | Scans localStorage/sessionStorage for tracking data | SHIPPED | [hamr0/weareleaking](https://github.com/hamr0/weareleaking) |
| 4 | wearecounted | Finds hidden tracking pixels, invisible iframes, and beacons | SHIPPED | [hamr0/wearecounted](https://github.com/hamr0/wearecounted) |
| 5 | wearesold | Detects connections to known data broker companies | SHIPPED | [hamr0/wearesold](https://github.com/hamr0/wearesold) |
| 6 | wearelinked | Exposes redirect chains and tracking parameters in links | — | — |
| 7 | wearewatched | Monitors when sites access device permissions and sensors | — | — |
| 8 | wearetracked | Shows fingerprinting techniques attempted by each page | — | — |
| 9 | wearedark | Scores websites for dark pattern manipulation tactics | — | — |
| 10 | weareexpired | Tracks privacy policy changes between visits | — | — |
| 11 | weareopen | Audits every third-party script loaded per page | — | — |
| 12 | wearesilent | Detects form input exfiltration before you click submit | — | — |

## Priority Order — Next Up

| # | Extension | Difficulty | Viral Potential | Build Order |
|---|-----------|-----------|----------------|-------------|
| 6 | wearelinked | Low–Med | Medium | Next — useful daily driver |
| 7 | wearewatched | Medium | High | Prototype wrapping practice |
| 8 | wearetracked | Medium | High | Similar technique to wearewatched |
| 9 | wearedark | Medium | Medium | DOM heuristics |
| 10 | weareexpired | Medium | Medium | Text diffing |
| 11 | weareopen | Medium | Medium | Builds on wearebaked patterns |
| 12 | wearesilent | High | Very High | Hardest but biggest payoff |

---

## Sources

- [Leaky Forms (USENIX Security 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol)
- [LeakInspector source code](https://github.com/leaky-forms/leak-inspector)
- [Princeton Web Transparency Project (2017)](https://privacyinternational.org/examples/1918/no-boundaries-exfiltration-personal-data-session-replay-scripts)
- [NYU: Privacy Extensions Fail User Needs](https://engineering.nyu.edu/news/privacy-enhancing-browser-extensions-fail-meet-user-needs-new-study-finds)
- [EFF on Manifest V3 Privacy Implications](https://www.eff.org/deeplinks/2021/12/googles-manifest-v3-still-hurts-privacy-security-innovation)
- [OWASP Browser Extension Vulnerabilities](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html)
