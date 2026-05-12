# wearecooked v5 — PRD

> Status: planning. v4.0.0 is the live baseline (cookie + pixel scanner, detection only). This PRD covers an experimental revival that adds two interventions — cookie scoping and fingerprint farbling — to the existing detector shell.

The experiment is bounded. Phase 3 has an explicit decision point: keep + maintain, split into siblings, or re-archive. Don't expand scope before that decision.

## Why this repo, not a new one

wearecooked was archived 2026-03-27 with v4.0.0 — cookie scanner, cookie cleaner, pixel/beacon detection, ~170 tracker domains classified. It already crossed the observer→intervener line once (the "Clean trackers" button). Adding two more interventions to a repo that already does one is cheaper than spinning up a new extension shell or converting a pure observer.

Considered alternatives:

- **wearewatched** (archived) — strong fingerprint plumbing (MAIN-world `inject.js` at `document_start`), but it's still a pure observer; would require crossing the intervention line for both features at once, plus a brand mismatch on the cookie half.
- **New repo** — clean slate, but no UI/UX reuse, no existing user mindshare, double the install friction. The "weare____" suite pattern is already established; reviving an existing entry is the cheaper move.
- **Inside wearehere** — rejected. wearehere is positioned as the aggregator/scanner; bundling intervention there muddles the truth-of-observation (any score would be "after my intervention"). Permissions scope creep, failure modes diverge, trust model differs. See the "addon vs new extension" reasoning in [docs/learnings.md](./docs/learnings.md) once written.

## The two features, in one container

### Phase 1 — Cookie scoper

**Promise.** Cookies the site sets get auto-shortened to a user-tunable cap (default 7 days, matches Safari ITP envelope), unless the site is on the user's trust list. Third-party cookies convert to session by default. The cookie cleaner from v4 stays as the destructive escalation.

**What we can do (today, MV3, no external deps):**

- `chrome.cookies.onChanged` fires on every set with `cause === 'explicit'`. Listener inspects the cookie + tab context, decides via a pure policy module, re-writes via `chrome.cookies.set` with capped `expirationDate` or omitted entirely (= session).
- Bundle the Public Suffix List (~30KB gzipped) for correct eTLD+1 third-party classification. `.co.uk` and friends can't be heuristic'd.
- Trust list lives in `chrome.storage.local`, keyed by eTLD+1, with explicit expiry (default 30d). Renewed by user action only.
- Loop prevention: filter `cause === 'overwrite'` (our own rewrites refire), dedupe by `name|domain|path` for 500ms.
- Borrowed knowledge feeds classification — phase 0 in wearehere extracts Cookie AutoDelete's tracker-name list; wearecooked v5 consumes the same file.

**What we can't do:**

- **CNAME-cloaked first-party trackers.** A cookie set by `analytics.adoptersite.com` (CNAMEd to a tracker) is legitimately first-party from the browser's perspective. Scoping it doesn't disconnect the join — the server-side pipeline still works. Mitigation requires DNR rules against a known-CNAME-tracker list; out of scope for v5.
- **Cookies set via `Set-Cookie` headers that get blocked before storage.** We act *after* storage via `onChanged`. For our use case (cap expiry, convert to session) this is identical in effect. If we ever want to *delete* before storage, we'd migrate to `chrome.declarativeNetRequest` `modifyHeaders`. Not needed for v5.
- **Server-side joins on logged-in identity.** Anything the user voluntarily gives up (email, account) is invisible to us.

**The 10 policy decisions** (documented up front; each is a default that can be flipped):

| # | Decision | Default | Rationale |
|---|---|---|---|
| 1 | Third-party definition | eTLD+1 mismatch via bundled PSL | Heuristic split-on-dot breaks `.co.uk` |
| 2 | First-party cap | 7 days (tunable 1 / 7 / 30) | Matches Safari ITP compat envelope |
| 3 | Third-party action | Convert to session | Preserves embed function during visit; dies on close |
| 4 | Trust marking | Explicit user button only — no login auto-detect | Auto-detect → false positives → we own the bug |
| 5 | HttpOnly cookies | Scope on non-trusted; leave alone on trusted | Untrusted-site logins *should* expire fast |
| 6 | `__Host-` / `__Secure-` prefix | Rewrite faithfully or skip | Chrome rejects malformed prefixed cookies |
| 7 | API choice | `chrome.cookies.onChanged` over DNR `modifyHeaders` | Simpler debugging, no rule budget |
| 8 | Loop prevention | `cause === 'explicit'` filter + 500ms dedupe | onChanged refires after our rewrite |
| 9 | Toggle UI | Popup row + detailed controls in cookie dashboard | Discoverable without bloating popup |
| 10 | Visibility | Live counter "N cookies scoped on this site" | Show what we did, don't silently lower the score |

### Phase 2 — Fingerprint farbler

**Promise.** Sites that probe canvas / WebGL / AudioContext / navigator entropy get deterministic per-origin-per-session noise instead of the real device signal. The MAIN-world `inject.js` from v4 already wraps these APIs for *notification*; phase 2 promotes the wrappers from "log" to "lie."

**What we can do:**

- **Constant lies on low-risk surfaces:** `WebGL.getParameter(UNMASKED_RENDERER_WEBGL / UNMASKED_VENDOR_WEBGL)` → fixed generic strings. `navigator.hardwareConcurrency` → 4. `navigator.deviceMemory` → 8. `navigator.languages` → `['en-US','en']`. `navigator.platform` → `"Win32"`. `screen.*` → coarse buckets. Each one is a few lines.
- **Farbling (deterministic noise) on read-back surfaces:** `Canvas.toDataURL` / `Canvas.getImageData`, `AudioBuffer.getChannelData`, `AnalyserNode.getFloatFrequencyData`. Seed = `HMAC(stableSecret, originHost + sessionId)`. Perturb low bits of a deterministic ~1% pixel/sample subset. Same site within a session → same noise → stable but fake fingerprint hash. Different site or new session → different noise. This is the Brave farbling pattern; algorithm is in their open-source `brave-core` (renderer-level C++, not directly liftable but the spec is published) and re-implemented in JShelter (GPL-3, liftable as a sub-module if license is sandboxed). Algorithms are not copyrightable; only the implementation is.
- **Time precision reduction:** `performance.now()` → 100µs floor. Defeats clock-skew fingerprinting and Spectre timing.
- **Font enumeration limits:** cap measured-fonts to ~10 stable choices via wrapping `measureText` / `offsetWidth` on a font-probe element.
- **Per-origin per-session seeding** is the key UX correctness property: a site that reads the canvas twice in one session must get the *same* hash both times, or it'll either retry (defeating us) or break visibly. JShelter's seed scheme works; lift it.

**What we can't do (be upfront in the README):**

- **Inline `<script>` running before `document_start`.** Our content script in MAIN world fires at the earliest extension-visible moment, but the page can run inline JS in `<head>` before that. Brave wins this race because it's in renderer-level C++; we cannot from an extension. The cost: maybe 2-5% of sites probe early. Real ceiling: ~95-98% effective.
- **TLS JA3/JA4 fingerprint.** Set by the OS network stack before the request leaves. Invisible to JS, unmodifiable.
- **HTTP/2 settings frame order.** Same — below the JS surface.
- **Real IP + ASN.** VPN/Tor territory, not extension.
- **Font enumeration via SVG glyph measurement.** We can blunt `measureText` / `offsetWidth`; a determined fingerprinter renders into an SVG and measures bounding boxes there. Mitigatable but not eliminatable.
- **Detection-as-fingerprint.** "User runs an anti-fingerprinting extension" is itself a (small) signal. Brave handles this by being the default for all Brave users; we can't. The honest framing: we raise the cost of identification, we don't eliminate it.

**Site-breakage risk is real and asymmetric vs. phase 1.** Anti-bot vendors — Cloudflare Turnstile, Akamai Bot Manager, DataDome, hCaptcha — read canvas/WebGL precisely to catch farblers. A too-aggressive v5 locks users out of banks, gov sites, airline checkouts. The mitigation:

1. Per-origin allowlist: a "Trust this site's fingerprint reads" button parallel to the cookie trust list. Same UX.
2. Default off. User must opt in per-extension, then can opt back per-site.
3. Determinism: JShelter-style seeded noise is *less* detectable than uniform random, because the site sees a stable hash.
4. Honest README: "Some anti-bot systems may flag farbled browsers. Trust the site to disable for it."

### Why combine them in one extension

The features are independent in code (different content scripts, different APIs, different storage namespaces) but coherent in promise: *"stop sites from tracking you — at the cookie layer and the device layer."* Two toggles in one popup, one install for the user, two distinct intervention surfaces.

If the experiment shows users want only one half, phase 3 splits them.

## Phase 3 — Decision point

After v5 ships and gets ~30 days of real use, decide:

- **Keep + maintain as one extension** if both features see use, neither breaks sites materially, and the maintenance load fits a single repo.
- **Split into siblings** (`wearescoped` + `wearemasked` or revive `wearewatched` for the fingerprint half) if one feature dominates installs, or if site breakage from one half is dragging the other's reputation.
- **Re-archive** if neither half clears a usefulness bar to be defined before launch (proposed: ≥100 weekly active installs combined OR ≥1 substantive bug-report-with-fix per month indicating real users; flat-zero on both = signal to stop).

Pre-define the bar; don't move it after launch.

## Borrowed knowledge — license + attribution plan

The features lean on prior art from two archived/dying projects. The plan is to lift *knowledge* (curated lists, algorithm specs), not codebases.

| Source | License | What we lift | Why it's OK |
|---|---|---|---|
| **Cookie AutoDelete** ([github.com/Cookie-AutoDelete/Cookie-AutoDelete](https://github.com/Cookie-AutoDelete/Cookie-AutoDelete)) | GPL-3.0 | Curated cookie-name tracker-pattern list (~200 entries: `__utma`, `_ga`, `_fbp`, `IDE`, `MUID`, …); essential-cookie allowlist for top sites (banking, gov, mail) | Lists are facts (not copyrightable in US; weak DB right in EU). Lifted with attribution, not as derived code. Phase 0 in wearehere extracts this; wearecooked v5 reads the same file. |
| **JShelter** ([jshelter.org](https://jshelter.org), code on Pagure) | GPL-3.0 | Enumerated list of fingerprint surfaces to wrap (~200 properties/methods); algorithm specs for canvas/audio/WebGL farbling, font enumeration limits, time-precision reduction | Algorithms not copyrightable. Surface list is facts. Implementations rewritten fresh. If we ever lift a JShelter source file verbatim, it lives in a GPL-3-licensed sub-package with its own NOTICE; otherwise wearecooked v5 stays MIT. |
| **CanvasBlocker** ([github.com/kkapsner/CanvasBlocker](https://github.com/kkapsner/CanvasBlocker)) | MPL-2.0 | Canvas-specific spoofing reference | MPL is per-file; can sub-module a verbatim file under MPL while wearecooked stays MIT. |
| **Brave farbling** (`brave-core`) | MPL-2.0 | Published algorithm specs (renderer-level C++; not directly liftable) | Spec is reference material; reimplementation in JS is greenfield. |

**Rule of thumb:** lift lists and specs; don't lift source files unless we're willing to sandbox them under their original license.

## Maintenance-mode ≠ "Chrome outplayed it" — survey findings

Documenting up front so future contributors don't waste time on the wrong concern.

Three ways Chrome can outplay an extension, and what actually happened:

1. **API removal** — Chrome deletes the primitive. **Did not happen.** `chrome.cookies` is fully intact in MV3. `chrome.scripting` MAIN-world is supported (Chrome 111+).
2. **API surface reduction** — Chrome narrows what the API can do. **Did not happen** for our use cases.
3. **Native feature absorption** — Chrome ships the behavior in-browser. **Partial:** 3p-cookie controls landed but per-site auto-scope + farbling did not. Chrome has no native equivalent for the hard parts.

What did happen: Cookie AutoDelete's maintainer stepped away (~2022-2023). JShelter has slow upstream cadence and EFF funding cycle dependencies. Single-maintainer projects starved out by MV3 port cost, not by API death. The *knowledge* in both projects is current and load-bearing.

Conclusion: the case for reviving the techniques is strong; the case for porting the codebases is weak. Lift the knowledge, write fresh code in our shell.

## Out of scope for v5

- CNAME-cloaked tracker blocking (DNR rule list, much bigger commitment)
- Full localStorage / IndexedDB / Cache Storage purge UX — Phase 1 may add a one-shot "Clear site storage" action using `chrome.browsingData.remove()` but not a managed lifecycle
- TLS-layer changes (impossible from an extension)
- Cross-browser parity beyond Chrome + Firefox (Safari Web Extensions need their own pass)
- npm package / programmatic API (wearehere already ships that for detection; intervention doesn't fit a headless-audit shape)

## Open questions

- **PSL update cadence.** Bundle once and forget, or fetch periodically? The list adds a few entries per quarter. Bundling and accepting <1% staleness is fine for v5.
- **Trust list export/import.** Power users will want to sync trust lists across browsers/devices. Not in v5; revisit if asked.
- **Telemetry.** Currently *none* — matches the "no data leaves your browser" promise. If we need to measure scope-then-broke-site rate, that's an in-browser counter the user can voluntarily share, not auto-uploaded.
- **Interaction with wearehere's score.** wearehere observes; wearecooked v5 alters. wearehere's score on a scoped/farbled site will be lower than reality. Acceptable — the install-flow recommends wearecooked, so the lower score *is* the success metric.

## Concrete next steps (do not execute from this PRD)

1. Phase 0 in wearehere — extract Cookie AutoDelete tracker-name list into a data file. Unblocks both wearehere classification *and* wearecooked v5 phase 1.
2. POC: 20-line script in wearecooked v5 that does `chrome.cookies.onChanged` → re-set with `session: true` for everything third-party, on a single test domain. Validate round-trip with no real policy module.
3. If POC works, write the full scoper module + PSL bundle + trust list + popup wiring.
4. Ship v5.0.0-alpha behind a default-off toggle. Real-user dogfood for a week.
5. Phase 2 fingerprint work begins only after phase 1 is stable.
