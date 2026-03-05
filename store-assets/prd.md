# wearecooked — Product Reference

## Overview

See what cookies websites drop on you — and the hidden pixels that deliver them.

wearecooked shows you what's really happening behind every website you visit. It detects the hidden tracking infrastructure that websites embed in your pages — invisible 1x1 tracking pixels, zero-size iframes, navigator.sendBeacon calls, and prefetch links to known tracker domains — then shows you exactly who's responsible.

Click the icon to see a per-site verdict: how many hidden trackers were found, grouped by purpose (Advertising, Analytics, Data broker) and by company (Google, Meta, Amazon, etc.). The badge turns red with a count when trackers are detected.

170+ tracker domains classified by company and purpose. Everything runs locally. No data leaves your browser. No accounts. No servers. No tracking the tracker.

Available as a **Chrome extension**, **Firefox extension** (incl. Android), **Safari extension** (macOS), and **Python CLI** (Linux).

## How it works

### Hidden tracker detection

The content script scans every page for hidden tracking infrastructure:

- **1x1 tracking pixels** — invisible images used to track page views and user activity
- **Invisible iframes** — zero-size iframes embedded by ad networks and data brokers
- **navigator.sendBeacon calls** — intercepted via a page-context wrapper (`inject.js`) to catch data exfiltration on page unload
- **Prefetch links** — `<link rel="prefetch">` pointing to known tracker domains, used to prime tracking connections
- **MutationObserver** — catches dynamically injected tracking elements after page load, so trackers added by delayed scripts are still detected
- **170+ tracker domains** — classified by company and purpose (Advertising, Analytics, Data broker, etc.) with URL pattern fallback for unknown domains

Results are stored per-tab. The badge shows a red count when trackers are found, gray "0" when the page is clean.

### Cookie Dashboard

Open the Cookie Dashboard to see every cookie in your browser classified by category — Analytics, Advertising, Social Media, Session/Auth, CDN, and more.

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

### Cookie Cleaner

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

### Cookie classification

Cookies are classified in two passes:

1. **Domain matching** — known tracker domains (doubleclick, google-analytics, facebook) and purpose domains (cloudflare, stripe, youtube) are identified by domain
2. **Name pattern matching** — cookie names checked against known patterns (`_ga`, `_fbp`, `cf_clearance`, `cart`, etc.)

First-party domains are derived from your actual cookie data, so third-party classification is based on what sites you visit, not a hardcoded list.

#### Cookie categories

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

## Python CLI

Reads cookie SQLite databases directly. Supports Chrome, Chromium, Brave, Edge, and Firefox. Zero external dependencies — stdlib only.

```bash
python3 cookie_tracker.py
```

**Close your browser first** if you get database lock errors. **Do not run with `sudo`**.

| Flag | Description | Default |
|------|-------------|---------|
| `-o`, `--output PATH` | HTML report output path | `~/cookie_report.html` |
| `--json PATH` | Also export raw cookie data as JSON | _(none)_ |

## Permissions

- **Chrome**: cookie access is an optional permission, requested at runtime on first use via a "Scan Cookies" button. Once granted, subsequent scans auto-load. The `storage` permission is used for per-tab scan results. Content scripts run on all URLs to detect hidden trackers. The cleaner uses `chrome.cookies.remove()` to delete selected cookies.
- **Firefox**: cookies + all URLs declared at install (required for `browser.cookies` API). Content scripts scan for hidden trackers. The cleaner uses `browser.cookies.remove()`. Requires Firefox 142+.
- **Safari**: same as Firefox — cookies + all URLs declared at install. Uses the `browser.*` API. Requires macOS with Safari 14+.
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
    manifest.json             # MV3, optional host permissions, content scripts
    background.js             # Scan result storage, badge updates, message handlers
    content.js                # DOM scanner: pixels, iframes, prefetches, MutationObserver
    inject.js                 # Page-context sendBeacon wrapper
    popup.html                # Popup shell (verdict + dashboard link)
    popup.js                  # Popup rendering (verdict, breakdown by purpose/company)
    popup.css                 # Popup styles (dark theme)
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
    manifest.json             # MV2, permissions at install, content scripts
    background.js             # In-memory tab storage, badge updates (browser.*)
    content.js                # Same scanner as Chrome (browser.* API)
    inject.js                 # Same sendBeacon wrapper
    popup.html                # Same popup shell
    popup.js                  # Same popup rendering (browser.* API)
    popup.css                 # Same popup styles
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
  safari-extension/           # Safari source (Manifest V2, same as Firefox)
    manifest.json             # MV2, no gecko-specific settings
    background.js             # Same as Firefox (browser.*)
    content.js                # Same as Firefox
    inject.js                 # Same as Firefox
    popup.html                # Same as Firefox
    popup.js                  # Same as Firefox
    popup.css                 # Same as Firefox
    cookies.js                # Same as Firefox (browser.*)
    report.html               # Same as Firefox
    report.js                 # Same as Firefox
    cleaner.html              # Same as Firefox
    cleaner.js                # Same as Firefox
    cleaner.css               # Same as Chrome/Firefox
    styles.css                # Same as Chrome/Firefox
    logo.png                  # Same as Chrome/Firefox
    favicon.png               # Same as Chrome/Firefox
    icon48.png                # Same as Chrome/Firefox
    icon128.png               # Same as Chrome/Firefox
  .github/workflows/
    build-safari.yml          # GitHub Actions: build Safari .app on macOS runner
```

## Chrome vs Firefox differences

- **Chrome** uses Manifest V3 with optional host permissions requested at runtime. Cookie access is granted via a "Scan Cookies" button on first use; subsequent scans auto-load. Uses `chrome.cookies.remove()` for the cleaner and `chrome.storage` for per-tab scan results.
- **Firefox** uses Manifest V2 with all permissions (cookies + all URLs) declared at install, as required by the `browser.cookies` API. The report and cleaner auto-load without a scan button. Uses `browser.cookies.remove()`. Requires Firefox 142+.
- **Safari** follows the same model as Firefox — Manifest V2, permissions declared at install, `browser.*` API. Requires macOS with Safari 14+.

## Changelog

### v3.0.0

- **Popup verdict** — clicking the icon now shows a per-site verdict: domain, hidden tracker count, and breakdown by purpose/company
- **Hidden pixel detection** — content script scans every page for 1x1 tracking pixels, invisible iframes, `<link rel="prefetch">` to tracker domains, and intercepted `navigator.sendBeacon` calls
- **Badge** — red badge with tracker count when tracking found, gray "0" when clean
- **170+ tracker domains** — classified by company and purpose (Advertising, Analytics, Data broker, etc.) with URL pattern fallback
- **MutationObserver** — catches dynamically injected tracking elements after page load
- **"Open Cookie Dashboard"** — popup links to the existing full cookie report

### v2.0.0

- **New logo** — detective/spy icon with white circle background replaces the old cooking emoji, used across the page header, browser tab favicon, and all store/promo images
- **Tagline** — "Your browser's cookie activity at a glance" shown under the header
- **Last scanned timestamp** — report subtitle now shows when the scan was performed
- **Auto-refresh** — checkbox (on by default) rescans cookies every 60 seconds so the report stays current while browsing
- **Updated store assets** — `store_icon_128.png`, `screenshot1.png`, `screenshot2.png`, and `promo_tile.png` regenerated with the new logo
- **Firefox extension ID** — updated to `wearecooked-v3@extension`
