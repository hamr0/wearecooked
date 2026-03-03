# Changelog

All notable changes to wearecooked will be documented in this file.

## [2.0.1] - 2026-03-03

### Added
- Safari extension support (macOS) — based on Firefox source (`browser.*` API, MV2)
- GitHub Actions workflow (`build-safari.yml`) to build Safari `.app` on macOS runner
- Safari install, build, and developer mode instructions in README
- Safari listed in permissions and project structure sections

## [2.0.0] - 2026-03-02

### Added
- New detective/spy logo replacing the cooking emoji, used across page header, browser tab favicon, and all store/promo images
- Tagline "Your browser's cookie activity at a glance" shown under the header
- Last-scanned timestamp in the report subtitle
- Auto-refresh checkbox (on by default) that rescans cookies every 60 seconds
- Dev setup instructions and manual testing checklist in README

### Changed
- Updated store assets: `store_icon_128.png`, `screenshot1.png`, `screenshot2.png`, `promo_tile.png` with new logo
- Updated Firefox extension ID to `wearecooked-v3@extension`
- Bumped version to 2.0.0 in both Chrome and Firefox manifests
- Expanded README with changelog section and file tree updates

## [1.0.1] - 2026-03-02

### Fixed
- Replaced `innerHTML` with `DOMParser` for AMO (Firefox Add-ons) compliance

## [1.0.0] - 2026-03-02

### Added
- Initial release: cookie scanner and cleaner for Chrome and Firefox
- Cookie classification engine (tracker, analytics, functional, etc.)
- Report page with domain breakdown, worst offenders, and risk cards
- Cookie cleaner with one-click tracker deletion
- Python CLI for Linux
