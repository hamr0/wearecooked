# Phase 1 POC — cookie scoper round-trip

**Status:** POC. Never shipped. Lives on branch `phase1-cookie-scoper`.

**Purpose:** Validate that the `chrome.cookies.onChanged` → `chrome.cookies.set`
round-trip actually works as imagined for cookie session-scoping. Once this is
proven on a happy path and two edges, stop and design the real module per
`AGENT_RULES.md`.

## What it does

Listens for cookies set on `example.com` (hardcoded). If a non-session cookie
has an expiry more than 30 days out, rewrites it as a session cookie. Skips
its own rewrite events to avoid a re-trigger loop.

## How to load

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select `poc/phase1-cookie-scoper/`
4. Click **service worker** link on the extension card to open its DevTools console

## How to test

Open `https://example.com/`, then in the page's DevTools console:

### Happy path
```js
document.cookie = "tracker=abc; expires=Fri, 31 Dec 2027 23:59:59 GMT; path=/";
```
**Expected:**
- POC console logs `[POC] rewriting -> session: {...}` then `[POC] rewrote ok: {...session:true}`
- Application tab → Storage → Cookies → `https://example.com` → `tracker` row shows **Expires/Max-Age = Session**

### Edge 1 — no re-trigger loop
Set the cookie again immediately. POC should rewrite once, then the follow-up
`explicit/not-removed` event arrives with `session:true` and the handler
short-circuits at the `if (cookie.session) return;` line. Verify the POC
console shows **one** rewrite per page-side set, not a runaway stream.

### Edge 2 — `__Host-` prefix
```js
document.cookie = "__Host-x=v; path=/; Secure; expires=Fri, 31 Dec 2027 23:59:59 GMT";
```
**Expected:**
- POC rewrites with `secure:true`, no `domain` attribute, path `/` preserved
- Application tab shows `__Host-x` session-scoped
- No `set failed` warning in POC console

If `__Host-` invariants are violated (somehow), POC logs `[POC] skip malformed
__Host- cookie:` and leaves it alone — also acceptable.

## What this POC does NOT do

- No public-suffix-list-aware third-party detection (Phase 1 module work)
- No allowlist / per-origin trust toggle (Phase 1 module work)
- No popup UI, no counter, no storage
- No JS-cookie vs HTTP-cookie distinction (treats them the same — that's
  fine for the API-surface validation this POC is scoped to)

## Exit criteria for the POC

All three of:
- Happy path round-trip works
- No re-trigger loops observed
- `__Host-` either preserves attributes cleanly OR skips cleanly with no Chrome rejection

When green, delete the POC mentally and start designing the real
`chrome-extension/scoper.js` module per the pick-up sequence in `PRD.md`.
