# Cookie scoper integration guide — for the wearehere agent

This kit ports wearecooked's cookie scoper UI (popup card + dashboard) into wearehere's extension. After the port, wearehere's popup shows the scoper card alongside its own detection cards, and wearehere's `#panel-cookies` shows the four-block management dashboard.

The actual cookie work (cron sweep, classification, rewriting) **stays in wearecooked**. wearehere is a UI host that talks to wearecooked via cross-extension messaging.

## Before you start — handshake

Both extensions need to know each other's stable extension IDs. Unpacked extensions get random IDs per load unless you pin them with a `key` field in `manifest.json`.

1. Generate stable extension IDs for both extensions. The simplest path is to publish the extension to the Chrome Web Store (any "private" listing) and use the assigned ID. For dev: use `tools/make-stable-key.sh` (any tutorial; OpenSSL one-liner) and put the generated `key` into both manifests so the ID is deterministic.
2. Note both IDs. You'll need them in three places:
   - wearecooked's `background.js` (`WEARECOOKED_ALLOWED_EXT_IDS`)
   - wearecooked's `manifest.json` (`externally_connectable.ids`)
   - wearehere's `port-kit/scoper-bridge.js` (`WEARECOOKED_EXT_ID`)

## Step 1 — wearecooked side, two edits

**1a.** Add `externally_connectable` to `chrome-extension/manifest.json`:

```json
"externally_connectable": {
  "ids": ["<wearehere-extension-id-here>"]
}
```

**1b.** Add the allowed-IDs constant to `chrome-extension/background.js`, top of file (above `importScripts`):

```js
self.WEARECOOKED_ALLOWED_EXT_IDS = ["<wearehere-extension-id-here>"];
```

The `onMessageExternal` handler is already wired (background.js, bottom of file). Without `WEARECOOKED_ALLOWED_EXT_IDS` it rejects all external messages, so it's safe to ship now; the handshake only activates once both edits are in place.

## Step 2 — wearehere side, files to copy

Copy everything in this `port-kit/` directory into wearehere, preserving structure. Suggested destination: `chrome-extension/scoper/` inside wearehere.

```
port-kit/
├── INTEGRATION-GUIDE.md       — this file; vendor as docs/SCOPER-INTEGRATION.md
├── scoper-bridge.js           — the data layer (cross-extension messaging adapter)
│
├── popup-card/                — the Cookie scoper card for wearehere's popup
│   ├── popup-card.html        — markup (insert into wearehere's popup.html)
│   ├── popup-card.css         — styles (load alongside wearehere's popup.css)
│   └── popup-card.js          — render logic; depends on scoper-bridge.js
│
└── dashboard-blocks/          — the four blocks for wearehere's panel-cookies
    ├── dashboard-blocks.html  — markup (insert into wearehere's report.html #panel-cookies)
    ├── dashboard-blocks.css   — styles (load alongside wearehere's report.css)
    └── dashboard-blocks.js    — render logic; depends on scoper-bridge.js
```

## Step 3 — wire scoper-bridge.js

Open `scoper-bridge.js`. At the top, replace the placeholder with wearecooked's extension ID:

```js
const WEARECOOKED_EXT_ID = "<wearecooked-extension-id-here>";
```

The bridge exposes `self.scoperDataLayer` with the read/write API. `popup-card.js` and `dashboard-blocks.js` call this layer for all data access — don't bypass it.

## Step 4 — embed the popup card

In wearehere's `popup.html`, insert the contents of `popup-card.html` at the location where the scoper section should live (e.g. after the "Who's watching" block, before the footer chip row). The markup is one `<div class="scoper-card">…</div>` — no `<html>/<body>` wrapper.

Then load the scripts in this order in `popup.html` (or whatever entry point wearehere uses):

```html
<link rel="stylesheet" href="scoper/popup-card/popup-card.css">
…
<script src="scoper/scoper-bridge.js"></script>
<script src="scoper/popup-card/popup-card.js"></script>
```

If wearehere's popup has its own init code, ensure `wireScoperCard()` is called after the popup card markup is in the DOM. `popup-card.js` auto-runs on `DOMContentLoaded`; if wearehere's popup uses a different init pattern, call `window.wearecookedScoper.initPopupCard()` directly.

CSS classes are all prefixed `.scoper-card …` so they won't collide with wearehere's existing styles.

## Step 5 — embed the dashboard

In wearehere's `report.html`, find `<div id="panel-cookies" class="panel"></div>` and replace its inner content with the contents of `dashboard-blocks.html`. Same rule: markup is just the four `<section>` blocks, no outer wrapper.

```html
<link rel="stylesheet" href="scoper/dashboard-blocks/dashboard-blocks.css">
…
<script src="scoper/scoper-bridge.js"></script>
<script src="scoper/dashboard-blocks/dashboard-blocks.js"></script>
```

`dashboard-blocks.js` auto-runs `initDashboard()` on `DOMContentLoaded`. If wearehere lazy-loads the cookies tab (only initializes when user clicks Cookies), call `window.wearecookedScoper.initDashboard()` from wearehere's tab-switch handler.

CSS classes prefixed `.scoper-dashboard …` to avoid collision.

## Step 6 — wearehere manifest

Add `cookies` permission to wearehere's manifest if it doesn't have it. The dashboard reads `chrome.cookies.getAll({domain})` directly (faster than round-tripping through wearecooked for cookie counts on every trust-list row).

```json
"permissions": ["..., "cookies"]
```

`host_permissions: ["<all_urls>"]` should already cover this if wearehere uses it elsewhere.

## Step 7 — verify

Reload both extensions in `chrome://extensions`. Then:

- Open wearehere's popup on any site. Scroll to the scoper card — it should show the eTLD+1, "default · 7 day cap", impact line, `[Sweep now]` + `[Trust 30d]` buttons.
- Click `Sweep now`. Within ~300ms, the lifetime footer should update and the status line should say "scanned N · rewrote M · demoted K".
- Click `Trust 30d`. Button toggles to `Remove trust`; the site line changes to "trusted · 30d cap".
- Open wearehere's report tab → Cookies. The four scoper blocks render with the same data.
- Add a domain via the dashboard add-row. It appears in the trusted-sites table immediately.
- Change the sweep period radio. The setting-status line shows "applied · next sweep in N min". The cron alarm in wearecooked is recreated with the new cadence.

If anything is dead-silent, the most common cause is the handshake — both extensions' IDs must match exactly in three places (Step 1a, 1b, 3).

## The cross-extension message API (for reference)

`scoper-bridge.js` wraps these. You shouldn't need to call them directly unless extending the UI.

| Message type | Payload | Response |
|---|---|---|
| `scoper:get-state` | — | `{scoperStats, scoperTrust, scoperSettings, scoperHistory, seenSites}` |
| `scoper:set-trust` | `{etld1: string, cap: 0|30|90}` | `{ok: true, trust}` or `{error}` |
| `scoper:set-settings` | `{settings: {alarmPeriodMin: 15|60|240|720}}` | `{ok: true}` or `{error}` |
| `scoper:sweep-now` | — | `{scanned, rewrites, demotions, …}` or `{gated: true, anchorSize}` |
| `scoper:cookie-count` | `{domain: string}` | `{count: number}` |

All messages require `sender.id` to be in `WEARECOOKED_ALLOWED_EXT_IDS`. Other extensions get `{error: "unauthorized"}`.

## What you don't need to port

- `psl.js`, `cookie-database.js`, `scoper.js`, `scoper-sweep.js` — these stay in wearecooked. They run in wearecooked's service worker. wearehere never touches them.
- The cron + seenSites logic.
- The harness (`tools/test-sweep.js`) — wearecooked owns that. Re-runs there when sweep code changes.

## What stays in wearecooked, even after the port

- wearecooked still has its **own** popup (`chrome-extension/popup.html`) and dashboard (`chrome-extension/dashboard.html`). They keep working in the wearecooked extension's own popup and as a fallback URL `chrome-extension://<wearecooked-id>/dashboard.html`. Don't delete them — users who install wearecooked alone still get the UI.
- After wearehere is published, you can choose: leave wearecooked's standalone UIs for power users / debugging, or simplify to a "you're using wearecooked through wearehere — see the wearehere icon for controls" pointer.

## Update flow

When wearecooked ships changes to the cookie policy or storage shape:

- If only `scoper.js` / `scoper-sweep.js` change → wearehere doesn't need to do anything; the bridge keeps working because the message API is stable.
- If the storage shape changes (e.g. new field on `scoperStats`) → bridge stays; UI files in port-kit need to be re-vendored. Diff against the previous port-kit checkout to see what's new.
- If the message API changes → bridge needs an update. Versioned message types (`scoper:get-state.v2`) would make this safer but aren't implemented yet; add if churn becomes painful.
