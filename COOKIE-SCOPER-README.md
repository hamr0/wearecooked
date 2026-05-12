# Cookie scoper — how it works

A plain-language tour of what wearecooked's cookie scoper does, why, and what it can't do. If you only read one section, read **"In one minute"**.

## In one minute

The scoper runs in the background, hourly by default. Every hour it walks every cookie in your browser and rewrites the expiry on each one:

- **First-party cookies on sites you've visited:** capped to **7 days**. A site's auth + preference cookies survive that week; you stay logged in. After 7 idle days they expire.
- **First-party cookies whose name is a known tracker (e.g. `_ga`, `_fbp`):** demoted to **session** even on sites you trust. Trust doesn't extend to known trackers.
- **Third-party cookies** (set by some other domain than the one you're visiting): demoted to **session**. They die when you quit Chrome.
- **Sites you explicitly trust** via the popup or dashboard: cap raised to **30 days** (popup) or **90 days** (dashboard). Tracker-name cookies still get demoted regardless of trust.

You don't have to do anything for this to happen. Install, browse, the scoper handles it.

The popup lets you sweep on demand (in case you don't want to wait an hour) and trust the current site with one click. The dashboard lets you see lifetime totals, manage trusted sites, change the sweep period, and review history.

## What "tightened" and "killed" mean

The two numbers in the popup footer and the dashboard hero:

- **Tightened** — cookies whose expiry the scoper shortened (e.g. 400 days → 7 days). The cookie still works; it just doesn't outlive its welcome.
- **Trackers killed** — cookies the scoper demoted to session because their name matched the Open Cookie Database's `Marketing` or `Analytics` category. "Killed" means they will not survive the next browser quit. They're alive *during* the session, intentionally — killing them mid-session breaks consent banners, A/B test buckets, etc.

"Killed" is a verb about lifecycle, not deletion at sweep time. The cookie sits in your jar as a session cookie until Chrome wipes it on browser quit. If a tracker re-sets the cookie before then, we re-demote on next sweep.

## How first-party vs third-party gets decided

The scoper has a set of "sites you've visited" (`seenSites`) that grows passively as you browse. Every time a page finishes loading on `http(s)`, the page's domain (specifically its eTLD+1: `nytimes.com`, `co.uk`-aware) is added to `seenSites`. It survives extension reload and browser restart.

When a sweep runs:

- For each cookie, look at its domain's eTLD+1.
- If it's in `seenSites` or in any currently-open tab → **first-party**.
- Otherwise → **third-party**.

This works because trackers don't appear in `seenSites` — you don't *navigate* to `doubleclick.net`, even though `cnn.com` loads pixels from it. The pixel loads happen via subresources; only top-level navigations get into `seenSites`.

The Public Suffix List is bundled (`psl.js`) so multi-part TLDs like `.co.uk` are handled correctly. `news.bbc.co.uk` is first-party for `bbc.co.uk`, not `co.uk`.

## The cron schedule

A `chrome.alarms` alarm fires on a fixed cadence (default: **hourly**). When it fires:

1. Service worker wakes.
2. Sweep walks every cookie via `chrome.cookies.getAll({})`.
3. For each cookie, decide the right expiry per the rules above.
4. If the result differs from the cookie's current expiry, rewrite it via `chrome.cookies.set`.
5. Update lifetime stats. Append one row to the history ring buffer.

You can change the cadence in the dashboard's **Settings** block: 15 min / hourly / 4 hours / 12 hours. Shorter = catches re-extended cookies faster; longer = fewer service worker wakes.

You can also click **Sweep now** in the popup to force an immediate sweep.

The first sweep after install / browser restart waits 1 minute. After that, the alarm is on its regular cycle.

## The "seen sites" gate

On a truly cold start (fresh install, no browsing history known), `seenSites` is empty. If a sweep ran immediately, every first-party cookie would look third-party (because the domain isn't in `seenSites` yet) and get demoted to session — wiping your auth cookies on every site you cared about.

To prevent that, sweeps triggered by the alarm or startup events **skip when `seenSites` has fewer than 10 entries**. The popup shows the current count and tells you when the gate is open.

Manual sweeps from the popup's **Sweep now** button **bypass the gate**. If you click it, the scoper assumes you accept the cold-start risk.

The gate is mostly an installation-day concern. After a few minutes of normal browsing, `seenSites` is well past 10 and stays there forever.

## The cat-and-mouse

Honest disclosure: this is the design's main limitation.

Many sites re-set their cookies on every page load. Reddit, for example, sends `Set-Cookie` with a 1-year expiry on every navigation. The flow:

```
sweep at T:        cap reddit cookie to 7d
T + 5 min:         you reload reddit → server sends Set-Cookie 1y → cookie now 1y
T + 5 min .. T+1h: cookie sits at 1y in your jar
T + 1h:            next sweep fires → cap back to 7d
```

We can only rewrite cookies *after* the browser stores them. Chrome extensions in MV3 can't intercept `Set-Cookie` headers at the network layer (`webRequest` is read-only, `declarativeNetRequest` can't modify response headers). True interception is a browser-engine feature; that's why Brave / Firefox Total Cookie Protection live in C++ / Rust, not in extensions.

What this means in practice:

- For sites you visit constantly, cookies spend most of their time at the *server's* expiry between sweeps, capped only briefly. Shorter sweep cadence narrows that window.
- For sites you visit occasionally, the cap holds: the cookie ages, hits 7d, and dies before the server gets a chance to re-extend.
- **Browser quit is the real reset.** All session cookies (including everything we demoted to session) get wiped by Chrome itself. Restart Chrome and trackers start clean.

The 7-day cap isn't a guarantee that no cookie lives past 7 days — it's a guarantee that no cookie *outlasts a week of not visiting the site*. That distinction matters.

## What you can adjust

| Knob | Where | Effect |
|---|---|---|
| Sweep period | Dashboard → Settings | How often the cron runs. 15 min / hourly (default) / 4 hours / 12 hours. |
| Per-site trust | Popup `[Trust 30d]` / Dashboard whitelist | Raise the cap from 7d to 30d or 90d for that domain's first-party cookies. Tracker-name cookies still get demoted regardless. |
| Sweep now | Popup `[Sweep now]` | Run a sweep immediately. Bypasses the seenSites gate. |

What you *can't* adjust (intentionally — defaults are locked):

- The 7-day default cap. PRD locked this on 2026-05-12 to defeat choice paralysis. 30/90d only via trust, no slider.
- The third-party rule. 3p cookies always demote to session. Trust never extends to 3p.
- The tracker demotion. Cookies whose names match the Open Cookie Database's `Marketing` / `Analytics` categories always demote to session, even on trusted sites.

## What goes where (UI map)

**Popup** (`popup.html`, opens on toolbar icon click):

- One Cookie scoper card. Shows the current site's eTLD+1, cap status, longest cookie expiry, and what was done last sweep (X tightened, Y killed *on this site*). Buttons: `[Sweep now]` and `[Trust 30d]` (or `[Remove trust]`).
- Lifetime footer: total tightened + total killed across all sites, time since last sweep.

**Dashboard** (`dashboard.html`, opens in its own tab from the popup):

- **Hero:** lifetime totals (tightened, killed, sites watched, last sweep).
- **Trusted sites:** the whitelist. Each row shows domain, tier (30d / 90d), live cookie count for that domain, and inline buttons (flip tier, remove). Add-row at the bottom for typing in a new domain.
- **Settings:** the sweep-period radio.
- **Recent activity:** ring buffer of the last 50 sweeps. Each row shows when, what triggered it, how many cookies were scanned, rewritten, demoted.

When the wearehere extension is ready for integration, both surfaces lift into it: the Cookie scoper card becomes one of wearehere's popup cards; the dashboard embeds via iframe in wearehere's Cookies tab. Until then, both surfaces ship standalone in wearecooked.

## Files (for developers)

- `chrome-extension/scoper.js` — pure policy module. `decideAction({cookie, thirdParty, trustList, cookieClass})` returns `{action, capDays, reason, etld1}`. No Chrome APIs; testable in any Node REPL.
- `chrome-extension/scoper-sweep.js` — cron + seenSites + sweep loop. Registers `chrome.alarms`, `chrome.tabs.onUpdated`, `chrome.runtime.onInstalled/onStartup`. Bootstraps seenSites from currently-open tabs on every SW load.
- `chrome-extension/cookie-database.js` — Open Cookie Database snapshot (vendored from JShelter). `classifyCookie(name) → {category, vendor} | null`. Cookies whose category is `Marketing` or `Analytics` get demoted to session.
- `chrome-extension/psl.js` — Public Suffix List, generated by `tools/build-psl.js`. Provides `PSL_NORMAL`, `PSL_WILDCARD`, `PSL_EXCEPTION` sets used by `etld1Of`.
- `chrome-extension/popup.{html,css,js}` — the Cookie scoper card.
- `chrome-extension/dashboard.{html,css,js}` — the management dashboard.
- `chrome-extension/background.js` — service worker entry. `importScripts` order matters: data files first, then policy, then sweep.
- `tools/test-scoper.js` — 36 cases against the pure policy module.
- `tools/test-sweep.js` — Node harness with stubbed `chrome.*` APIs. Runs the actual sweep against synthetic fixtures and asserts post-state per cookie. Run with `node tools/test-sweep.js`.

## Privacy + security caveats

- **CNAME-cloaked first-party trackers.** A cookie set by `analytics.adoptersite.com` that is CNAMEd to a tracker is legitimately first-party from Chrome's perspective. We cap it to 7d but the join still works server-side. Out of scope.
- **Server-side identity joins.** Anything you voluntarily provide (email, account login) is invisible to us. The scoper is about cookies as a tracking surface, not identity in general.
- **`__Host-` malformed cookies.** Cookies prefixed `__Host-` must be host-bound, secure, and at path `/`. Some sites set them malformed (with a Domain attribute or leading dot). Chrome stores them; our rewrite would fail Chrome's validation, so we skip them rather than risk leaving the cookie in an inconsistent state. They keep their original expiry.
- **No deletion before storage.** We act *after* `Set-Cookie` is processed. Identical in effect for cap/demote purposes. For `delete-before-storage` semantics we'd need `declarativeNetRequest`; not implemented and probably not needed.

## When to suspect the scoper is broken

- **Lifetime stats are 0/0 after browsing for a while.** Check the dashboard's Recent activity. If the latest sweeps say "gated," `seenSites` hasn't grown past 10. Browse normally for a few more minutes or click Sweep now in the popup.
- **A site keeps logging you out.** Trust it via `[Trust 30d]` in the popup. If the issue persists, the site is setting an `httpOnly` session cookie that we're not capping (we only modify what's already in the jar; we don't extend anything). Not a scoper bug.
- **Cookie expiry shown elsewhere disagrees with what the popup says.** Some Chrome UIs (e.g. Application panel) show the *server-set* expiry from `Set-Cookie` headers, not the stored cookie's current `expirationDate`. Re-check via `chrome.cookies.getAll` in the SW console.
- **Recent activity log shows `rewrote 0` forever.** That's the cap holding — no work to do, no cookies exceeded their cap. Healthy state.
