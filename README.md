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
2. Click **Load unpacked** → select `chrome-extension/`

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** → select `firefox-extension/manifest.json`

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
  wearecooked-chrome.zip      # Chrome Web Store upload
  wearecooked-firefox.zip     # Firefox Add-ons upload
  wearecooked-cleaner-poc.zip # Chrome with cleaner (dev build)
  chrome-extension/           # Chrome source (Manifest V3)
    manifest.json             # MV3, optional host permissions
    background.js             # Opens report on icon click
    cookies.js                # Chrome cookie API adapter
    report.html               # Report page shell
    report.js                 # Classification engine + report rendering
    cleaner.html              # Cookie cleaner page shell
    cleaner.js                # Cleaner logic + deletion (chrome.cookies.remove)
    cleaner.css               # Cleaner-specific styles
    styles.css                # Shared styles (report + cleaner)
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
```
