# wearecooked v5 — PRD

> Status: planning. v4.0.0 is the live baseline (cookie + pixel scanner, detection only). This PRD covers an experimental revival that adds two interventions — cookie scoping and fingerprint farbling — to the existing detector shell.
>
> **Source correction (2026-05-12).** Original draft named *Cookie AutoDelete* as the cookie-pattern source; investigation showed CAD bundles no curated list — it's a user-expressions framework. Switched to the **Open Cookie Database** (jkwakman/Open-Cookie-Database, Apache-2.0, 2,264 cookies / 354 vendors / 6 categories). Same shape, better data. Already landed in wearehere as `chrome-extension/cookie-database.js`; wearecooked v5 will vendor that snapshot.
>
> **Process discipline.** Work on v5 follows the project agent rules at `.claude/memory/AGENT_RULES.md` (in the wearehere repo; mirrored conceptually here). Hard rules for this experiment: **POC first on a new branch**, vanilla → stdlib → external dependency hierarchy, surgical changes only, responsive UI for any dashboard work. POCs validate happy path + 2-3 common edges; they are never shipped — they graduate into a designed module after the idea is proven.

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
- Borrowed knowledge feeds classification — phase 0 in wearehere has landed `cookie-database.js` (Open Cookie Database snapshot, 1,989 exact + 260 prefix entries); wearecooked v5 vendors this file unchanged.

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
| **Open Cookie Database** ([github.com/jkwakman/Open-Cookie-Database](https://github.com/jkwakman/Open-Cookie-Database)) | Apache-2.0 | Curated 2,264-cookie classification (1,989 exact + 260 prefix patterns) × {Analytics, Marketing, Functional, Necessary, Security, Personalization} across 354 vendors | Lifted as factual data with attribution. Apache-2.0 imposes no infection on wearecooked's MIT shell. Already vendored in wearehere (`cookie-database.js`); wearecooked v5 imports the same snapshot. |
| **JShelter** ([jshelter.org](https://jshelter.org), GitHub mirror [patrik-dekys/JShelter-webextension](https://github.com/patrik-dekys/JShelter-webextension)) | GPL-3.0 | Enumerated list of fingerprint surfaces (~149 properties/methods in `wrappers-lvl_0_1.json`); algorithm specs for canvas/audio/WebGL farbling, font enumeration limits, time-precision reduction | Algorithms not copyrightable. Surface list is facts (already vendored in wearehere as `fingerprint-surfaces.js`); wearecooked v5 imports it. Implementations rewritten fresh — never lift JShelter source files. If we ever need to lift a JShelter source file verbatim, it lives in a GPL-3-licensed sub-package with its own NOTICE; otherwise wearecooked v5 stays MIT. |
| **CanvasBlocker** ([github.com/kkapsner/CanvasBlocker](https://github.com/kkapsner/CanvasBlocker)) | MPL-2.0 | Canvas-specific spoofing reference | MPL is per-file; can sub-module a verbatim file under MPL while wearecooked stays MIT. |
| **Brave farbling** (`brave-core`) | MPL-2.0 | Published algorithm specs (renderer-level C++; not directly liftable) | Spec is reference material; reimplementation in JS is greenfield. |

**Rule of thumb:** lift lists and specs; don't lift source files unless we're willing to sandbox them under their original license.

## Maintenance-mode ≠ "Chrome outplayed it" — survey findings

Documenting up front so future contributors don't waste time on the wrong concern.

Three ways Chrome can outplay an extension, and what actually happened:

1. **API removal** — Chrome deletes the primitive. **Did not happen.** `chrome.cookies` is fully intact in MV3. `chrome.scripting` MAIN-world is supported (Chrome 111+).
2. **API surface reduction** — Chrome narrows what the API can do. **Did not happen** for our use cases.
3. **Native feature absorption** — Chrome ships the behavior in-browser. **Partial:** 3p-cookie controls landed but per-site auto-scope + farbling did not. Chrome has no native equivalent for the hard parts.

What did happen: cookie-side prior art is scattered across maintenance-mode tools (Cookie AutoDelete) and active data sources (Open Cookie Database, the actual seed of most consent-tool ecosystems). JShelter has slow upstream cadence and EFF funding cycle dependencies. Single-maintainer projects starved out by MV3 port cost, not by API death. The *knowledge* in both areas is current and load-bearing.

Conclusion: the case for reviving the techniques is strong; the case for porting the codebases is weak. Lift the knowledge, write fresh code in our shell.

**Process learning from Phase 0 itself:** the original PRD draft pointed at Cookie AutoDelete for the cookie-name list. Investigation showed CAD bundles no curated list — it's a framework, not a dataset. The Open Cookie Database (which seeds most consent-tool ecosystems) is the correct source. The discipline of "verify the prior art before committing the integration" earned its keep here, and reinforces the AGENT_RULES POC-first principle even for documentation work.

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

## What's next — pick up here

All future work on v5 follows `.claude/memory/AGENT_RULES.md` (see "Process discipline" at top). The first move on resuming is always a POC on a feature branch — never directly on `main`.

### Status of upstream Phase 0 (already done, in wearehere)

- ✅ `chrome-extension/cookie-database.js` — Open Cookie Database snapshot (1,989 exact + 260 prefix patterns). Apache-2.0, NOTICE attribution.
- ✅ `chrome-extension/fingerprint-surfaces.js` — JShelter wrappers-lvl_0_1 snapshot (149 surfaces, 12 categories). GPL-3.0 source, factual lift, NOTICE attribution.
- ⏳ Wiring into wearehere's runtime classification (separate change).

### Phase 1 (cookie scoper) — pick up sequence

1. **Create feature branch** — `git checkout -b phase1-cookie-scoper`. All POC and module work lives on this branch until graduation.
2. **POC** (~15 min, branch only, never merged) — minimal `chrome.cookies.onChanged` → `chrome.cookies.set` round-trip on a single test domain. Hardcoded values fine. Validate:
   - Happy path: third-party cookie set with 1-year expiry → rewritten as session cookie within ~50ms.
   - Edge 1: our own rewrite doesn't infinite-loop (`cause === 'overwrite'` filter).
   - Edge 2: `__Host-` prefixed cookie either rewrites with all attributes preserved, or is skipped cleanly (no Chrome rejection logs).
   POC validates the API surface works as imagined; if it does, stop and design properly.
3. **Vendor `cookie-database.js`** from wearehere into wearecooked at the same snapshot SHA. Pin in NOTICE.
4. **Bundle PSL** — vanilla-language solution preferred. Generate a static `psl.js` (Set of public suffixes) from `publicsuffix.org/list/public_suffix_list.dat`. No npm dep; one-time build script in `tools/`.
5. **Build the scoper module incrementally**, smallest pieces first, each working in isolation before the next:
   - `scoper.js` (pure policy function, no Chrome APIs) — testable in console.
   - `chrome.cookies.onChanged` listener with dedupe map.
   - Trust list in `chrome.storage.local`, explicit-add only.
   - Popup toggle (responsive — already small, but verify on narrow viewport).
   - Counter ("N cookies scoped on this site") on the existing cookies card.
6. **Decision points to revisit at design time** — the 10 policy defaults in the Phase 1 table above. Each is a default, not a constraint.
7. **Ship as v5.0.0-alpha**, default OFF, dogfood for ~1 week before defaulting ON.

### Phase 2 (fingerprint farbler) — gates and pick-up sequence

Phase 2 begins **only after Phase 1 is stable in real use for ≥2 weeks with no significant site-breakage reports.** Anti-bot vendor detection risk is real and isolated debugging of two interventions at once is hard.

1. **Create feature branch** — `git checkout -b phase2-fingerprint-farbler` off the stabilized main.
2. **POC** (~15 min) — promote a single existing `inject.js` wrapper from notify-only to lie-only on a test page. Example: `WebGL.getParameter(UNMASKED_RENDERER_WEBGL)` → fixed generic string. Validate happy path + that real WebGL rendering still works on a non-fingerprint test site.
3. **Vendor `fingerprint-surfaces.js`** from wearehere at pinned snapshot SHA.
4. **Incremental wrapper rollout**, low-risk surfaces first (constants), then farbling (noise) last:
   - Tier A constants: `WebGL.getParameter`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `navigator.languages`, `navigator.platform`, `screen.*` buckets, `performance.now()` precision.
   - Tier B farbling: canvas pixel noise (deterministic seed = `HMAC(secret, originHost + sessionId)`), audio buffer noise, font enumeration cap.
   - Stop after Tier A if site-breakage reports surface; Tier B is the higher-risk slice.
5. **Per-origin allowlist** (mirrors the cookie trust list) for users who hit anti-bot challenges.
6. **Ship as v5.1.0-alpha** with both halves, default OFF on the farbler.

### Phase 3 — decide

After ~30 days of real v5.x use:
- Keep + maintain as one extension if both halves see use and neither drags the other.
- Split into siblings (revive `wearewatched` for the fingerprint half) if one feature dominates installs or breaks sites materially.
- Re-archive if neither half clears the pre-defined bar (≥100 weekly active installs combined OR ≥1 substantive bug-report-with-fix per month). Bar is set *before* launch; don't move it after.

### Open items the next agent should not re-derive

- Cookie AutoDelete is the wrong source — Open Cookie Database is the right source. Don't re-investigate.
- Lift lists/algorithms, not codebases. Never `git submodule add` an upstream extension repo.
- wearehere's PRD has already done Phase 0 extraction; vendor those exact files, don't re-fetch from upstream unless versioning forces it.
- The 10 cookie policy decisions are documented above. Each is a default, not a debate to reopen.
- Tier A vs Tier B fingerprint rollout order is deliberate — constants first because they're low-risk; farbling last because anti-bot detection asymmetry makes it the dangerous one.
