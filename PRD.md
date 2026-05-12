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

**Promise.** Cookies the site sets get auto-shortened, unless the site is on the user's trust list. Third-party cookies convert to session by default. The cookie cleaner from v4 stays as the destructive escalation.

**v5 UX defaults (locked 2026-05-12).** The product is default-ON with non-negotiable defaults to defeat choice paralysis. A graduated trust model replaces the original "tunable cap" idea:

| Cookie origin / trust state | Resulting expiry |
|---|---|
| First-party, untrusted (default) | **7 days** (ITP-equivalent) |
| Third-party (always) | **Session** (dies on tab close); trust does not extend to third parties |
| First-party, trusted (popup one-click) | **30 days** (default trust action) |
| First-party, trusted (power-user opt) | **90 days** (dashboard toggle) |
| First-party **by domain** but classified by OCD as `Marketing` or `Analytics` | **Session** (added 2026-05-12 after dogfood) — trust does not extend to known trackers, same spirit as the third-party rule |

**Why the tracker-demotion row.** Real dogfood on cnn.com surfaced that many "trackers" set their cookies on `.cnn.com` (via Google/Adobe/Quantcast/etc. scripts running inside the page). They look first-party by domain but are tracker cookies by name. Without this rule, `__gads`, `__gpi`, `__qca`, `AMCV_*` and friends would survive at 7d (or 30/90 if trusted) instead of dying with the session. The Open Cookie Database we vendored already classifies them — wiring its `category` field into the policy turns a "1p by domain" cookie into "session" when its name is a known tracker. The 7d cap remains for Functional, Necessary, Security, Personalization. Trust still extends to non-tracker 1p cookies on the trusted site.

Surfaces:

- **Popup**: one-click "Trust this site" button → adds current eTLD+1 with 30d cap. Visible, undo-able from the dashboard. This is the "site broke, fix it in two clicks" escape hatch that makes default-ON survivable.
- **Dashboard**: list of trusted sites with per-site 30d/90d radio + remove button. Power-user surface only; basic users never need to open it.
- **Counter on existing cookies card**: "N cookies scoped on this site" — show what we did, not silently lower the score.

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
| 2 | First-party cap | 7 days, **not tunable** (see "v5 UX defaults" — 30d/90d only via trust) | Matches Safari ITP envelope; tunable slider invites choice paralysis we explicitly traded off |
| 3 | Third-party action | Convert to session **always** (trust does not extend to 3p) | Preserves embed function during visit; dies on close; trusting a 1p doesn't trust its trackers |
| 4 | Trust marking | Explicit user button only (popup one-click) — no login auto-detect | Auto-detect → false positives → we own the bug |
| 5 | HttpOnly cookies | Scope on non-trusted; leave alone on trusted | Untrusted-site logins *should* expire fast |
| 6 | `__Host-` / `__Secure-` prefix | Rewrite faithfully or skip | Chrome rejects malformed prefixed cookies |
| 7 | API choice | `chrome.cookies.onChanged` over DNR `modifyHeaders` | Simpler debugging, no rule budget |
| 8 | Loop prevention | `cause === 'explicit'` filter + 500ms dedupe | onChanged refires after our rewrite |
| 9 | Toggle UI | Popup row + detailed controls in cookie dashboard | Discoverable without bloating popup |
| 10 | Visibility | Live counter "N cookies scoped on this site" | Show what we did, don't silently lower the score |

### Phase 1 UI surfaces (locked 2026-05-13)

Two surfaces. **Popup** is contextual / per-site. **Dashboard** is global / cross-site. No "current site" card in the dashboard; no full whitelist in the popup. Same vocabulary across both.

**Popup — `popup.html`** (single Cookie scoper card; the same DOM later embeds inside wearehere's popup as one of several detection cards):

```
┌─ wearecooked · scoper ─────────────────
│  nytimes.com · 7 day cap
│  longest cookie 400d → 7d · 19 tightened, 3 killed
│
│  [ Sweep now ]   [ Trust 30d ]
│
│  ──────────────────────────────────────
│  113 tightened · 31 killed · last sweep just now
└────────────────────────────────────────
```

Impact-line state machine:

| State | Site line | Impact line |
|---|---|---|
| Pre-first-sweep on this site | `nytimes.com · 7 day cap` | `longest cookie 400d → will trim to 7d` |
| After a sweep ran here | `nytimes.com · 7 day cap` | `longest cookie 400d → 7d · 19 tightened, 3 killed` |
| All cookies ≤ 7d already | `example.com · 7 day cap` | `all cookies within cap ✓` |
| Trusted | `nytimes.com · trusted · 30d cap` | `cookies passing through · 0 tightened` |

Action rules:

- `[ Sweep now ]` always present.
- `[ Trust 30d ]` when site is untrusted; replaced by `[ Remove trust ]` when trusted.
- **`Trust 90d` does not ship in the popup** — that tier lives in the dashboard whitelist only. 90d is "I live here," which is a deliberate decision worth the extra click.

**Dashboard — `dashboard.html`** (standalone tab; opened from popup or `chrome-extension://<id>/dashboard.html`; later embedded into wearehere's `#panel-cookies`):

```
┌─ Cookie scoper ──────────────────────────────────────────────────────────┐
│  157           45               47               last sweep              │
│  tightened     trackers killed  sites watched    12m ago                 │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Trusted sites · 9 ──────────────────────────────────────────────────────┐
│  Domain               Trust    Cookies stored    Actions                 │
│  gmail.com            90d      42                [→ 30d]  [✕]            │
│  github.com           30d      18                [→ 90d]  [✕]            │
│  …                                                                       │
│  Add  [_______________________________]  [30d ▾]   [Add]                 │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Settings ───────────────────────────────────────────────────────────────┐
│  Sweep period      ( ) 15 min   (•) hourly   ( ) 4 hrs   ( ) 12 hrs      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent activity ─────────────────────────────────────────────── [▾] ────┐
│  1p anchor: 47 sites watched · gate opens at 10 (open)                   │
│  14:32  alarm     1047  rewrote 12  demoted 3                            │
│  13:32  alarm     1043  rewrote  0  demoted 0                            │
│  …                                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Behaviors:
- Trust does **not** decay. No "Expires" column. Until ✕, trust holds.
- Tier toggle is a single-button flip: 30d row shows `[→ 90d]`, 90d row shows `[→ 30d]`.
- Add-row default is 30d (selector flips to 90d). 90d is the deliberate tier.
- Sweep period radios mutate `scoperSettings.alarmPeriodMin` and recreate the alarm.
- Recent activity collapsed by default; expand shows last 10, "show all" reveals 50.
- **No "Sweep now" or per-site detail in dashboard.** Manual sweep is contextual → popup only.

**Storage contract (locked):**

```js
chrome.storage.local: {
  scoperStats: {
    rewrites:    number,                       // lifetime
    demotions:   number,                       // lifetime
    lastSweepAt: number,                       // ms epoch
    bySite: { [etld1]: { rewrites, demotions } } // per-site, accumulated
  },
  scoperTrust:    { [etld1]: { capDays: 30|90, addedAt: number } },
  scoperSettings: { alarmPeriodMin: 15 | 60 | 240 | 720 },
  scoperHistory:  [ { at, trigger, scanned, rewrites, demotions, gated, anchorSize } ],
                  // ring buffer, oldest dropped past 50
  seenSites:      [ "eTLD+1", … ]
}
```

**Cross-extension integration path (later, not now):**

When wearehere is ready to embed cookie-scoper UI:
- Cookie scoper popup card → ported into wearehere's popup as one of its detection cards (same DOM/CSS lifted from `popup.html`).
- Cookie scoper dashboard → embedded via iframe in wearehere's `#panel-cookies`, OR ported with `externally_connectable` messaging for shared theming. v1 is the iframe.

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
| **Open Cookie Database** ([github.com/jkwakman/Open-Cookie-Database](https://github.com/jkwakman/Open-Cookie-Database)) | Apache-2.0 | Curated 2,264-cookie classification (1,989 exact + 260 prefix patterns) × {Analytics, Marketing, Functional, Necessary, Security, Personalization} across 354 vendors | Lifted as factual data with attribution. Apache-2.0 matches wearecooked's own license (relicensed 2026-05-12); clean compatibility. Already vendored in wearehere (`cookie-database.js`); wearecooked v5 imports the same snapshot. |
| **JShelter** ([jshelter.org](https://jshelter.org), GitHub mirror [patrik-dekys/JShelter-webextension](https://github.com/patrik-dekys/JShelter-webextension)) | GPL-3.0 | Enumerated list of fingerprint surfaces (~149 properties/methods in `wrappers-lvl_0_1.json`); algorithm specs for canvas/audio/WebGL farbling, font enumeration limits, time-precision reduction | Algorithms not copyrightable. Surface list is facts (already vendored in wearehere as `fingerprint-surfaces.js`); wearecooked v5 imports it. Implementations rewritten fresh — never lift JShelter source files. If we ever need to lift a JShelter source file verbatim, it lives in a GPL-3-licensed sub-package with its own NOTICE; otherwise wearecooked v5 stays Apache-2.0. |
| **CanvasBlocker** ([github.com/kkapsner/CanvasBlocker](https://github.com/kkapsner/CanvasBlocker)) | MPL-2.0 | Canvas-specific spoofing reference | MPL is per-file; can sub-module a verbatim file under MPL while wearecooked stays Apache-2.0. |
| **Brave farbling** (`brave-core`) | MPL-2.0 | Published algorithm specs + short C++ snippets used as reference only (e.g. seeded-noise pixel-perturb shape, audio buffer perturbation density). Re-implemented in JS. | Algorithms are not copyrightable. We may read `brave-core` source to clarify a spec, but never link/import/transcribe verbatim — the *structural* wall is "extensions ship JS, not C++ inside Blink," not the license. MPL-2.0 is per-file friendly for C++ projects; irrelevant here. Attribute the reference in NOTICE; never claim Brave-equivalent ceiling. |

**Rule of thumb:** lift lists and specs; don't lift source files unless we're willing to sandbox them under their original license.

## Competitive landscape (surveyed 2026-05-12)

Re-surveyed Chrome's cookie-management extension landscape before locking the Phase 1 mechanism. The graduated-cap combo (1p=7d / 3p=session / trust=30d/90d / default-ON / one-click popup trust) is not packaged anywhere. Closest prior art and the precise differentiator vs each:

| Tool | Mechanism | What it shares | What it lacks |
|---|---|---|---|
| **Chrome (native, 2024+)** | 400-day cap on any cookie with `Expires`/`Max-Age` | Cap-rewrite pattern | Way too permissive; no 1p/3p split; no trust UX |
| **Safari ITP** | 7d cap on JS-set + suspicious-server 1p cookies | The exact cap we picked | Safari-only; not user-tunable; no override UX |
| **`semenko/chrome-limit-cookie-lifetime`** | Rewrites all cookie expiry to a single user-set value | Cap-rewrite mechanism (closest to ours) | MV2 only; **broken since Chrome's mid-2024 MV2 sunset**; no 1p/3p split; no whitelist; abandoned (last push 2023-07-27, 6 stars) |
| **Cookie Guardian** (MV3, active) | Delete on tab close + scheduled aging | Active MV3 cookie-extension shape; whitelist UX | **Deletes** instead of capping (loses cross-tab continuity); binary whitelist (protected vs auto-deleted, no graduated cap); no 1p/3p split; paywall on >10 sites |
| **Cookie-AutoDelete-MV3 fork** | Same model as Cookie Guardian | — | Same gaps as Cookie Guardian |
| **Brave shields** | Block 3p outright at the browser shield layer | Default-ON, no choice paralysis | Whole-browser commitment; can't run alongside other browsers; 1p left alone |

**Honest framing for README/marketing:** "Chrome's 400-day cap is too permissive; Cookie Guardian deletes-on-close (we cap-rewrite, preserving cross-tab continuity within a session); Brave blocks 3p entirely (we session-scope so embeds work). We're the 7d/session/30d/90d graduated default."

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

### Phase 1 (cookie scoper) — shipped on `phase1-cookie-scoper` (21 commits, unmerged)

All scope below is built and validated. Branch is held back from `main` pending real-world dogfood. Live state:

- ✅ POC validated round-trip on example.com (`31447ff`).
- ✅ Vendored `cookie-database.js` (Open Cookie Database, byte-identical to wearehere snapshot `2d81a5a`).
- ✅ Bundled PSL via `tools/build-psl.js` → `chrome-extension/psl.js` (9916+283+8 rules, MPL-2.0 per-file).
- ✅ Pure policy module (`scoper.js`) with 36 isolation tests in `tools/test-scoper.js`.
- ✅ Cron architecture — `chrome.alarms` + `seenSites` Set in `chrome.storage.local`. Live `onChanged` listener was built, dogfooded, found racy under SW-wake, and **deleted in favor of the cron** (`61b25d3`). The listener is gone; the sweep does all the work.
- ✅ OCD-aware tracker demotion — 1p Marketing/Analytics cookies demote to session even on trusted sites (`d5235d3`).
- ✅ Cold-start gate — auto-sweeps skip until `seenSites.size >= 10`; manual sweeps (popup `[Sweep now]`) bypass.
- ✅ Stats counter — lifetime + per-site accumulators in `scoperStats` (`1b76532`).
- ✅ Sweep history ring buffer — last 50 sweeps in `scoperHistory`.
- ✅ Configurable sweep period — `scoperSettings.alarmPeriodMin` ∈ {15, 60, 240, 720}, default 60.
- ✅ **Popup** (`popup.html`) — single Cookie scoper card per the locked UI section above.
- ✅ **Dashboard** (`dashboard.html`) — four blocks: hero, trusted sites, settings, recent activity.
- ✅ Node test harness — `tools/test-sweep.js`, 21 deterministic assertions against the actual sweep code with stubbed `chrome.*` APIs.

**Architecture differences from the original pick-up sequence** (worth knowing if reading old context):
- We do **not** use `chrome.cookies.onChanged` in production. Cron-only design.
- `inflight` Map and `cause === 'explicit'` filter from the original plan are obsolete — there's no listener to dedupe.
- Loop avoidance is handled by `decideAction`'s "already-within-cap" branch — works for both sweep passes (idempotency verified in harness).
- Trust list shape is `{[etld1]: {capDays, addedAt}}` — `capDays` is 30 or 90 (no expiry on trust entries).

**What's intentionally left for after dogfood** (don't pre-build):
- Cross-extension integration with wearehere (`#panel-cookies` iframe of `dashboard.html`).
- Trust list export/import.
- Telemetry — still none, still by design.

**Pick-up sequence for the next agent if Phase 1 needs touch-up:**

1. Read `COOKIE-SCOPER-README.md` — plain-language tour of how it works.
2. Read the PRD "Phase 1 UI surfaces (locked 2026-05-13)" section — surface contract.
3. Run `node tools/test-sweep.js`. Expect 21/21 pass. Any failure means a regression in the sweep code path.
4. Don't re-add the live listener. Don't re-introduce a tunable default-cap slider. Don't make trust decay.

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
