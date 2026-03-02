# wearecooked

Scan cookies, see who tracks you, and clean trackers in one click. Local-only — no data leaves your browser.

No data leaves your browser. No accounts. No tracking the tracker.

Available as a **Chrome extension**, **Firefox extension** (incl. Android), and **Python CLI** (Linux).

## Install

**Chrome** — [Chrome Web Store](https://chromewebstore.google.com/) _(pending review)_

**Firefox** — [Firefox Add-ons](https://addons.mozilla.org/) _(pending review)_

Click the extension icon to generate a report.

- **Chrome**: first time opens a "Scan Cookies" button (Chrome requires a click to grant permission). After that, reports auto-load instantly.
- **Firefox**: reports auto-load every time (permissions granted at install).

### Load from source (developer mode)

**Chrome/Chromium:**
1. Open `chrome://extensions/` → enable **Developer mode**
2. Click **Load unpacked** → select the `chrome-extension/` folder
3. Click the extension icon in the toolbar to open the report
4. To test changes: make edits → go back to `chrome://extensions/` → click the refresh icon on the extension card → reopen the report

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `firefox-extension/manifest.json`
3. Click the extension icon in the toolbar to open the report
4. To test changes: make edits → go back to `about:debugging` → click **Reload** on the extension card → reopen the report
5. Note: temporary add-ons are removed when Firefox closes — reload each session

**Manual testing checklist:**
- [ ] Report loads and shows cookie data
- [ ] Tagline "Your browser's cookie activity at a glance" appears under the header
- [ ] "Last scanned" timestamp is shown
- [ ] Auto-refresh checkbox is checked by default and rescans every 60s
- [ ] Unchecking auto-refresh stops the timer
- [ ] Logo (detective icon with white circle) appears in the page header and browser tab
- [ ] Cookie Cleaner link works from the CTA banner and footer
- [ ] Cleaner page loads, pre-selects trackers, and deletion works
- [ ] Table toggle expands/collapses the full cookie list

## What's new in v2.0.0

- **New logo** — detective/spy icon with white circle background replaces the old cooking emoji, used across the page header, browser tab favicon, and all store/promo images
- **Tagline** — "Your browser's cookie activity at a glance" shown under the header
- **Last scanned timestamp** — report subtitle now shows when the scan was performed
- **Auto-refresh** — checkbox (on by default) rescans cookies every 60 seconds so the report stays current while browsing
- **Updated store assets** — `store_icon_128.png`, `screenshot1.png`, `screenshot2.png`, and `promo_tile.png` regenerated with the new logo
- **Firefox extension ID** — updated to `wearecooked-v3@extension`

## Python CLI (Linux)

Reads cookie SQLite databases directly. Supports Chrome, Chromium, Brave, Edge, and Firefox. Zero external dependencies — stdlib only.

```bash
python3 cookie_tracker.py
```

**Close your browser first** if you get database lock errors. **Do not run with `sudo`**.

| Flag | Description | Default |
|------|-------------|---------|
| `-o`, `--output PATH` | HTML report output path | `~/cookie_report.html` |
| `--json PATH` | Also export raw cookie data as JSON | _(none)_ |

## What the report shows

- **Summary cards** — total cookies, unique domains, tracking/ads percentage (color-coded risk), secure (HTTPS) vs insecure count, session vs persistent split
- **Category tag chips** — at-a-glance counts for Analytics, Advertising, Social Media, E-commerce, CDN, and Session/Auth categories
- **CTA banner** — prominent link to the Cookie Cleaner with tracker count
- **First-party vs third-party bar** — visual ratio of your cookies vs tracking cookies
- **Privacy insights** — flags specific concerns:
  - Expired cookies still stored (dead weight)
  - Long-lived cookies (expiry over 1 year — persistent tracking risk)
  - Cross-site cookies (SameSite=None — follow you across websites)
- **Worst offenders** — top 8 domains ranked by suspicion score based on tracking category, cross-site cookies, missing security flags, and long expiry
- **Category breakdown** — visual bar chart of all cookie categories
- **Full cookie table** — collapsed by default, expandable. Filterable by search and category, sortable by any column

Mobile-friendly layout for Firefox Android.

## Cookie Cleaner

The cleaner is a second page accessible from the report via the CTA banner or footer link. It uses the same classification engine to let you selectively delete cookies.

**How it works:**
1. Scans and classifies all cookies using the same engine as the report
2. Groups cookies by category with risky categories (Analytics, Advertising, Social Media, Third-party) shown first
3. Pre-selects tracking cookies for deletion — login, preference, CDN, captcha, e-commerce, and functional cookies are **not selected** by default
4. One-click "Select Trackers Only" resets to the safe default selection
5. Per-category and per-cookie checkboxes for fine-grained control
6. Confirmation dialog before deletion with login cookie warning
7. Auto-rescans after deletion to show updated state

**Safety rails:**
- Session/Auth cookies are never pre-selected for deletion
- Real-time counter shows how many login cookies are protected
- Warning if any Session/Auth cookies are manually selected
- Confirmation dialog with breakdown of what gets deleted vs kept

**Access:** Report footer link or CTA banner → opens `cleaner.html`

## Cookie categories

| Category | What it means |
|----------|---------------|
| Analytics / Tracking | Data collection (Google Analytics, Mixpanel, Hotjar, etc.) |
| Advertising | Ad targeting and retargeting (DoubleClick, Facebook pixel, etc.) |
| Social Media Tracking | Cookies from embedded social content (YouTube, Twitter, Instagram) that track you across sites |
| Session / Auth | Login sessions, CSRF tokens, auth state |
| Preference | Language, theme, consent banners, timezone |
| CDN / Performance | Cloudflare, Akamai, Fastly, AWS load balancer cookies |
| Captcha / Security | reCAPTCHA, hCaptcha, Cloudflare challenges |
| E-commerce / Payment | Cart, checkout, Stripe, PayPal, Shopify |
| Third-party (uncategorized) | From domains you don't directly visit, not matching known patterns |
| Functional / Other | First-party cookies that don't match any known pattern |

## How classification works

Cookies are classified in two passes:

1. **Domain matching** — known tracker domains (doubleclick, google-analytics, facebook) and purpose domains (cloudflare, stripe, youtube) are identified by domain
2. **Name pattern matching** — cookie names checked against known patterns (`_ga`, `_fbp`, `cf_clearance`, `cart`, etc.)

First-party domains are derived from your actual cookie data, so third-party classification is based on what sites you visit, not a hardcoded list.

## Permissions

- **Chrome**: cookie access is an optional permission, requested at runtime on first use via a "Scan Cookies" button. Once granted, subsequent scans auto-load. The cleaner uses `chrome.cookies.remove()` to delete selected cookies. No broad permissions at install time.
- **Firefox**: cookies + all URLs declared at install (required for `browser.cookies` API). The cleaner uses `browser.cookies.remove()`. Requires Firefox 142+.
- **Python CLI**: reads SQLite files directly from `~/.config/` — no network, no root needed

## Project structure

```
wearecooked/
  cookie_tracker.py           # Python CLI (Linux)
  store_icon_128.png          # Store icon (detective logo, white circle, dark bg)
  screenshot1.png             # Store screenshot (1280x800)
  screenshot2.png             # Store screenshot (1280x800)
  promo_tile.png              # Promo tile (440x280)
  chrome-extension/           # Chrome source (Manifest V3)
    manifest.json             # MV3, optional host permissions
    background.js             # Opens report on icon click
    cookies.js                # Chrome cookie API adapter
    report.html               # Report page shell
    report.js                 # Classification engine + report rendering + auto-refresh
    cleaner.html              # Cookie cleaner page shell
    cleaner.js                # Cleaner logic + deletion (chrome.cookies.remove)
    cleaner.css               # Cleaner-specific styles
    styles.css                # Shared styles (report + cleaner)
    logo.png                  # Page header logo (detective icon, black on transparent)
    favicon.png               # Tab favicon (detective icon on white circle)
    icon48.png                # Extension icon 48x48 (white circle)
    icon128.png               # Extension icon 128x128 (white circle)
  firefox-extension/          # Firefox source (Manifest V2)
    manifest.json             # MV2, permissions at install
    background.js             # Opens report on icon click (browser.*)
    cookies.js                # Firefox cookie API adapter (browser.*)
    report.html               # Report page (no scan button, auto-loads)
    report.js                 # Same classification + rendering as Chrome
    cleaner.html              # Cleaner page (no scan button, auto-loads)
    cleaner.js                # Cleaner logic + deletion (browser.cookies.remove)
    cleaner.css               # Same as Chrome
    styles.css                # Same as Chrome
    logo.png                  # Same as Chrome
    favicon.png               # Same as Chrome
    icon48.png                # Same as Chrome
    icon128.png               # Same as Chrome
```
