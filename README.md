# wearecooked

> See what cookies websites drop on you — and the hidden pixels that deliver them.

wearecooked shows you the hidden tracking infrastructure websites embed in your pages — invisible 1x1 tracking pixels, zero-size iframes, navigator.sendBeacon calls, and prefetch links to known tracker domains. Click the icon for a per-site verdict. Open the Cookie Dashboard for a full breakdown of every cookie in your browser, classified by category with risk scoring. The built-in Cookie Cleaner lets you selectively delete tracking cookies in one click.

170+ tracker domains classified by company and purpose. Everything runs locally — no data leaves your browser.

## What it detects
- Hidden tracking pixels and invisible iframes
- navigator.sendBeacon calls and prefetch links to tracker domains
- Cookies classified by category: Analytics, Advertising, Social Media, CDN, Session/Auth, and more
- Cross-site cookies, long-lived trackers, and expired cookie dead weight
- Worst offender domains ranked by suspicion score

## Try It Now

Store approval pending — install locally in under a minute:

### Chrome
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `chrome-extension` folder
4. That's it — browse any site and click the extension icon

### Firefox
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → pick any file in the `firefox-extension` folder
4. That's it — browse any site and click the extension icon

> Firefox temporary add-ons reset when you close the browser — just re-load next session.

---

## The weare____ Suite

Privacy tools that show what's happening — no cloud, no accounts, nothing leaves your browser.

| Extension | What it exposes |
|-----------|----------------|
| **wearecooked** | Cookies, tracking pixels, and beacons |
| [wearebaked](https://github.com/hamr0/wearebaked) | Network requests, third-party scripts, and data brokers |
| [weareleaking](https://github.com/hamr0/weareleaking) | localStorage and sessionStorage tracking data |
| [wearelinked](https://github.com/hamr0/wearelinked) | Redirect chains and tracking parameters in links |
| [wearewatched](https://github.com/hamr0/wearewatched) | Browser fingerprinting and silent permission access |
| [weareplayed](https://github.com/hamr0/weareplayed) | Dark patterns: fake urgency, confirm-shaming, pre-checked boxes |
| [wearetosed](https://github.com/hamr0/wearetosed) | Toxic clauses in privacy policies and terms of service |
| [wearesilent](https://github.com/hamr0/wearesilent) | Form input exfiltration before you click submit |

All extensions run entirely on your device and work on Chrome and Firefox.
