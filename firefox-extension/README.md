# wearecooked - Source Code

## Build Instructions

This extension requires **no build step**. The source code is the extension — no transpilation, bundling, or minification is used.

To create the installable ZIP:

```
cd firefox-extension
zip -r ../wearecooked-firefox.zip . -x '.*' -x 'README.md'
```

## Requirements

- No build tools required
- No dependencies
- Tested on Firefox 142+

## File Structure

- `manifest.json` — Extension manifest (MV2)
- `background.js` — Opens report/cleaner page on toolbar click
- `cookies.js` — Cookie retrieval (browser.cookies API)
- `report.js` — Cookie analysis and report rendering
- `report.html` — Report page shell
- `cleaner.js` — Cookie classification and deletion UI
- `cleaner.html` — Cleaner page shell
- `cleaner.css` — Cleaner-specific styles
- `styles.css` — Shared styles
- `icon48.png` / `icon128.png` — Extension icons
