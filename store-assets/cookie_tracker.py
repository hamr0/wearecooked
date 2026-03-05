#!/usr/bin/env python3
"""
Cookie Tracker - Browser Cookie Analysis Report Generator
Reads cookie databases from Chrome/Chromium and Firefox on Linux
and generates a detailed HTML report similar to F12 DevTools view.
"""

import sqlite3
import os
import sys
import shutil
import tempfile
import json
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from collections import Counter
import html as html_lib

# --- Browser cookie database paths ---

def find_chrome_cookie_dbs():
    """Find all Chrome/Chromium cookie databases."""
    home = Path.home()
    candidates = [
        home / ".config/google-chrome",
        home / ".config/chromium",
        home / ".config/BraveSoftware/Brave-Browser",
        home / ".config/microsoft-edge",
    ]
    results = []
    for base in candidates:
        if base.exists():
            for profile_dir in base.iterdir():
                cookie_file = profile_dir / "Cookies"
                if cookie_file.is_file():
                    browser_name = base.name.replace("google-chrome", "Chrome").replace("chromium", "Chromium").replace("Brave-Browser", "Brave").replace("microsoft-edge", "Edge")
                    results.append((browser_name, str(profile_dir.name), str(cookie_file)))
    return results


def find_firefox_cookie_dbs():
    """Find all Firefox cookie databases."""
    home = Path.home()
    base = home / ".mozilla/firefox"
    results = []
    if base.exists():
        for profile_dir in base.iterdir():
            cookie_file = profile_dir / "cookies.sqlite"
            if cookie_file.is_file():
                results.append(("Firefox", str(profile_dir.name), str(cookie_file)))
    return results


# --- Cookie extraction ---

def chrome_timestamp_to_datetime(chrome_ts):
    """Convert Chrome timestamp (microseconds since 1601-01-01) to datetime."""
    if chrome_ts == 0:
        return None
    try:
        epoch_start = datetime(1601, 1, 1, tzinfo=timezone.utc)
        return epoch_start + timedelta(microseconds=chrome_ts)
    except (OverflowError, ValueError, OSError):
        return None


def firefox_timestamp_to_datetime(ts):
    """Convert Firefox timestamp (seconds since epoch) to datetime."""
    if ts == 0:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OverflowError, ValueError, OSError):
        return None


def read_chrome_cookies(db_path):
    """Read cookies from a Chrome/Chromium cookie database."""
    cookies = []
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    try:
        shutil.copy2(db_path, tmp.name)
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Try different schemas (Chrome has changed over versions)
        try:
            cursor.execute("""
                SELECT host_key, name, path, encrypted_value, value,
                       expires_utc, is_secure, is_httponly, samesite,
                       creation_utc, last_access_utc, is_persistent,
                       source_scheme
                FROM cookies
                ORDER BY host_key, name
            """)
        except sqlite3.OperationalError:
            cursor.execute("""
                SELECT host_key, name, path, encrypted_value, value,
                       expires_utc, is_secure, is_httponly, samesite,
                       creation_utc, last_access_utc, is_persistent
                FROM cookies
                ORDER BY host_key, name
            """)

        for row in cursor.fetchall():
            row_dict = dict(row)
            expires = chrome_timestamp_to_datetime(row_dict.get("expires_utc", 0))
            created = chrome_timestamp_to_datetime(row_dict.get("creation_utc", 0))
            last_access = chrome_timestamp_to_datetime(row_dict.get("last_access_utc", 0))

            # Cookie value: Chrome encrypts cookies, so value may be empty
            value = row_dict.get("value", "")
            encrypted = bool(row_dict.get("encrypted_value", b""))
            if not value and encrypted:
                value = "[encrypted]"

            samesite_map = {0: "None", 1: "Lax", 2: "Strict", -1: "Unspecified"}
            samesite_val = samesite_map.get(row_dict.get("samesite", -1), "Unknown")

            cookies.append({
                "domain": row_dict["host_key"],
                "name": row_dict["name"],
                "value": value[:120] + ("..." if len(value) > 120 else ""),
                "path": row_dict["path"],
                "expires": expires.strftime("%Y-%m-%d %H:%M") if expires else "Session",
                "secure": bool(row_dict.get("is_secure", 0)),
                "httponly": bool(row_dict.get("is_httponly", 0)),
                "samesite": samesite_val,
                "created": created.strftime("%Y-%m-%d %H:%M") if created else "—",
                "last_access": last_access.strftime("%Y-%m-%d %H:%M") if last_access else "—",
                "persistent": bool(row_dict.get("is_persistent", 0)),
            })

        conn.close()
    except Exception as e:
        print(f"  ⚠ Error reading {db_path}: {e}", file=sys.stderr)
    finally:
        os.unlink(tmp.name)
    return cookies


def read_firefox_cookies(db_path):
    """Read cookies from a Firefox cookie database."""
    cookies = []
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    try:
        shutil.copy2(db_path, tmp.name)
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT host, name, value, path, expiry,
                   isSecure, isHttpOnly, sameSite,
                   creationTime, lastAccessed
            FROM moz_cookies
            ORDER BY host, name
        """)

        for row in cursor.fetchall():
            row_dict = dict(row)
            expires = firefox_timestamp_to_datetime(row_dict.get("expiry", 0))
            # Firefox creationTime and lastAccessed are in microseconds
            created = firefox_timestamp_to_datetime(row_dict.get("creationTime", 0) / 1_000_000) if row_dict.get("creationTime") else None
            last_access = firefox_timestamp_to_datetime(row_dict.get("lastAccessed", 0) / 1_000_000) if row_dict.get("lastAccessed") else None

            value = row_dict.get("value", "")

            samesite_map = {0: "None", 1: "Lax", 2: "Strict"}
            samesite_val = samesite_map.get(row_dict.get("sameSite", 0), "Unknown")

            cookies.append({
                "domain": row_dict["host"],
                "name": row_dict["name"],
                "value": value[:120] + ("..." if len(value) > 120 else ""),
                "path": row_dict["path"],
                "expires": expires.strftime("%Y-%m-%d %H:%M") if expires else "Session",
                "secure": bool(row_dict.get("isSecure", 0)),
                "httponly": bool(row_dict.get("isHttpOnly", 0)),
                "samesite": samesite_val,
                "created": created.strftime("%Y-%m-%d %H:%M") if created else "—",
                "last_access": last_access.strftime("%Y-%m-%d %H:%M") if last_access else "—",
                "persistent": expires is not None,
            })

        conn.close()
    except Exception as e:
        print(f"  ⚠ Error reading {db_path}: {e}", file=sys.stderr)
    finally:
        os.unlink(tmp.name)
    return cookies


# --- Cookie classification ---

TRACKER_PATTERNS = {
    "Analytics / Tracking": [
        "_ga", "_gid", "_gat", "_gcl", "__utm", "amplitude", "mixpanel",
        "mp_", "ahoy_", "_hjid", "_hjSession", "hubspot", "_fbp", "_fbc",
        "intercom", "ajs_", "segment", "_clck", "_clsk", "clarity",
        "plausible", "matomo", "_pk_", "piwik",
    ],
    "Advertising": [
        "IDE", "DSID", "NID", "ANID", "1P_JAR", "APISID", "SSID",
        "fr", "xs", "datr", "sb",  # Facebook
        "muc_ads", "personalization_id",  # Twitter/X
        "_rdt_uuid",  # Reddit
        "li_sugr",  # LinkedIn
        "__gads", "__gpi", "test_cookie",
    ],
    "Session / Auth": [
        "session", "sess", "sid", "csrf", "token", "auth", "login",
        "connect.sid", "PHPSESSID", "JSESSIONID", "ASP.NET_SessionId",
        "remember", "logged_in", "user_id", "_account", "sso",
        "li_at", "twitter_sess", "reddit_session",
    ],
    "Preference": [
        "lang", "locale", "theme", "dark_mode", "consent", "cookie_consent",
        "gdpr", "ccpa", "OptanonConsent", "CookieConsent",
        "timezone", "tz", "country", "region", "pref", "settings",
        "dismiss", "banner", "notice", "accepted",
    ],
    "CDN / Performance": [
        "__cf", "cf_", "__cfduid", "cf_clearance", "cf_bm",
        "_cfuvid", "__cflb",
        "__akamai", "ak_bmsc", "bm_sv", "bm_sz",
        "_fastly", "x-cache",
        "awsalb", "awsalbcors", "AWSALB",
    ],
    "Captcha / Security": [
        "captcha", "recaptcha", "hcaptcha", "challenge", "cf_clearance",
        "turnstile", "__gh_sess", "device_id", "fingerprint",
        "_abck", "bm_sz",
    ],
    "Social Media Tracking": [
        "youtube", "yt-remote", "YSC", "VISITOR_INFO",
        "vimeo_", "twitch",
        "ig_", "instagram",
        "lidc",
        "player",
    ],
    "E-commerce / Payment": [
        "cart", "basket", "checkout", "stripe", "paypal",
        "shopify", "shop_", "_shopify",
        "wishlist", "recently_viewed", "product",
    ],
}

TRACKER_DOMAINS = [
    "doubleclick.net", "google-analytics.com", "googleadservices.com",
    "googlesyndication.com", "facebook.com", "facebook.net",
    "analytics.twitter.com", "ads.twitter.com", "amazon-adsystem.com",
    "adsrvr.org", "adnxs.com", "criteo.com", "outbrain.com",
    "taboola.com", "scorecardresearch.com", "quantserve.com",
    "bluekai.com", "demdex.net", "krxd.net", "rubiconproject.com",
    "pubmatic.com", "casalemedia.com", "openx.net", "indexexchange.com",
    "hotjar.com", "clarity.ms", "mouseflow.com", "fullstory.com",
    "amplitude.com", "mixpanel.com", "segment.io", "segment.com",
    "hubspot.com", "intercom.io", "drift.com",
]

# Domains classified by purpose (not tracking)
PURPOSE_DOMAINS = {
    "CDN / Performance": [
        "cloudflare.com", "akamaized.net", "akamai.net", "fastly.net",
        "cloudfront.net", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
        "bootstrapcdn.com", "gstatic.com", "ajax.googleapis.com",
    ],
    "Captcha / Security": [
        "recaptcha.net", "hcaptcha.com", "challenges.cloudflare.com",
    ],
    "Social Media Tracking": [
        "youtube.com", "youtu.be", "vimeo.com", "twitch.tv",
        "twitter.com", "x.com", "instagram.com", "linkedin.com",
        "reddit.com", "discord.com", "tiktok.com", "pinterest.com",
    ],
    "E-commerce / Payment": [
        "stripe.com", "paypal.com", "shopify.com", "braintreegateway.com",
        "square.com", "checkout.com",
    ],
}


def classify_cookie(domain, name, first_party_domains=None):
    """Classify a cookie into a category based on domain and name patterns."""
    name_lower = name.lower()
    domain_lower = domain.lower().lstrip(".")

    # Check tracker domains first
    for td in TRACKER_DOMAINS:
        if td in domain_lower:
            return "Advertising" if any(kw in td for kw in ["ad", "syndication", "doubleclick"]) else "Analytics / Tracking"

    # Check purpose domains (CDN, social, payment, etc.)
    for category, domains in PURPOSE_DOMAINS.items():
        for pd in domains:
            if pd in domain_lower:
                return category

    # Check name-based classification
    for category, patterns in TRACKER_PATTERNS.items():
        for pattern in patterns:
            if pattern.lower() in name_lower:
                return category

    # Check for third-party: domain not matching any first-party site
    if first_party_domains:
        is_first_party = any(
            domain_lower == fp or domain_lower.endswith("." + fp)
            for fp in first_party_domains
        )
        if not is_first_party:
            return "Third-party (uncategorized)"

    return "Functional / Other"


# --- HTML Report ---

def generate_report(all_browser_data, output_path):
    """Generate an HTML report from collected cookie data."""
    total_cookies = sum(len(cookies) for _, _, cookies in all_browser_data)
    all_cookies = []
    for browser, profile, cookies in all_browser_data:
        for c in cookies:
            c["_browser"] = f"{browser} ({profile})"
            all_cookies.append(c)

    # Compute stats
    category_counts = Counter(c["category"] for c in all_cookies)
    domain_counts = Counter(c["domain"] for c in all_cookies)
    top_domains = domain_counts.most_common(20)
    secure_count = sum(1 for c in all_cookies if c["secure"])
    httponly_count = sum(1 for c in all_cookies if c["httponly"])
    session_count = sum(1 for c in all_cookies if c["expires"] == "Session")
    persistent_count = total_cookies - session_count

    # Risk score
    risky_categories = {"Analytics / Tracking", "Advertising", "Third-party (uncategorized)", "Social Media Tracking"}
    risky_count = sum(1 for c in all_cookies if c["category"] in risky_categories)
    risk_pct = (risky_count / total_cookies * 100) if total_cookies else 0

    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    now_utc = datetime.now(timezone.utc)

    # --- Privacy insights ---
    # Stale cookies: last accessed 30+ days ago
    stale_cookies = []
    for c in all_cookies:
        if c["last_access"] != "\u2014":
            try:
                la = datetime.strptime(c["last_access"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                if (now_utc - la).days > 30:
                    stale_cookies.append(c)
            except ValueError:
                pass

    # Long-lived cookies: expiry more than 1 year from now
    long_lived_cookies = []
    for c in all_cookies:
        if c["expires"] != "Session":
            try:
                exp = datetime.strptime(c["expires"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                if (exp - now_utc).days > 365:
                    long_lived_cookies.append(c)
            except ValueError:
                pass

    # Insecure cookies: not marked Secure
    insecure_cookies = [c for c in all_cookies if not c["secure"]]

    # No HttpOnly: accessible to JavaScript
    no_httponly_cookies = [c for c in all_cookies if not c["httponly"]]

    # SameSite=None: cross-site tracking vectors
    samesite_none_cookies = [c for c in all_cookies if c["samesite"] == "None"]

    # First-party vs third-party ratio
    third_party_categories = {"Third-party (uncategorized)", "Analytics / Tracking", "Advertising", "Social Media Tracking"}
    third_party_count = sum(1 for c in all_cookies if c["category"] in third_party_categories)
    first_party_count = total_cookies - third_party_count

    # --- Worst offenders: score each domain by suspicion ---
    domain_scores = {}
    for c in all_cookies:
        d = c["domain"].lower().lstrip(".")
        if d not in domain_scores:
            domain_scores[d] = {"domain": d, "count": 0, "score": 0, "reasons": set()}
        ds = domain_scores[d]
        ds["count"] += 1
        if c["category"] in risky_categories:
            ds["score"] += 3
            ds["reasons"].add(c["category"])
        if c["samesite"] == "None":
            ds["score"] += 2
            ds["reasons"].add("Cross-site (SameSite=None)")
        if not c["secure"]:
            ds["score"] += 1
            ds["reasons"].add("Missing Secure flag")
        if c["expires"] != "Session":
            try:
                exp = datetime.strptime(c["expires"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                if (exp - now_utc).days > 365:
                    ds["score"] += 2
                    ds["reasons"].add("Long-lived (1yr+)")
            except ValueError:
                pass

    worst_offenders = sorted(domain_scores.values(), key=lambda x: -x["score"])[:15]
    max_score = worst_offenders[0]["score"] if worst_offenders else 1

    cat_colors = {
        "Analytics / Tracking": "#e74c3c",
        "Advertising": "#e67e22",
        "Session / Auth": "#2ecc71",
        "Preference": "#3498db",
        "CDN / Performance": "#1abc9c",
        "Captcha / Security": "#f39c12",
        "Social Media Tracking": "#e84393",
        "E-commerce / Payment": "#00b894",
        "Third-party (uncategorized)": "#9b59b6",
        "Functional / Other": "#95a5a6",
    }

    # Build category chart data
    cat_items = sorted(category_counts.items(), key=lambda x: -x[1])

    # Build cookie table rows
    table_rows = []
    for c in all_cookies:
        cat = c["category"]
        color = cat_colors.get(cat, "#95a5a6")
        value_display = html_lib.escape(c["value"]) if c["value"] else '<span class="empty">empty</span>'
        table_rows.append(f"""
        <tr data-category="{html_lib.escape(cat)}" data-browser="{html_lib.escape(c['_browser'])}">
            <td class="domain">{html_lib.escape(c['domain'])}</td>
            <td class="name">{html_lib.escape(c['name'])}</td>
            <td class="value" title="{html_lib.escape(c['value'])}">{value_display}</td>
            <td>{c['path']}</td>
            <td>{c['expires']}</td>
            <td class="flags">
                {'<span class="flag secure">Secure</span>' if c['secure'] else ''}
                {'<span class="flag httponly">HttpOnly</span>' if c['httponly'] else ''}
                <span class="flag samesite">SS:{c['samesite']}</span>
            </td>
            <td><span class="cat-badge" style="background:{color}">{html_lib.escape(cat)}</span></td>
            <td>{c['created']}</td>
            <td>{c['last_access']}</td>
            <td class="browser-col">{html_lib.escape(c['_browser'])}</td>
        </tr>""")

    report_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cookie Tracker Report — {now_str}</title>
<style>
  :root {{
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #242836;
    --border: #2e3346;
    --text: #e2e4ea;
    --text2: #8b8fa3;
    --accent: #6c5ce7;
    --red: #e74c3c;
    --orange: #e67e22;
    --green: #2ecc71;
    --blue: #3498db;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
    line-height: 1.5;
  }}
  h1 {{
    font-size: 1.8rem;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 12px;
  }}
  h1 .icon {{ font-size: 2rem; }}
  .subtitle {{ color: var(--text2); margin-bottom: 24px; font-size: 0.9rem; }}

  /* Summary cards */
  .cards {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }}
  .card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
  }}
  .card .label {{ color: var(--text2); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }}
  .card .val {{ font-size: 1.8rem; font-weight: 700; margin-top: 4px; }}
  .card .val.risk-low {{ color: var(--green); }}
  .card .val.risk-med {{ color: var(--orange); }}
  .card .val.risk-high {{ color: var(--red); }}

  /* Sections */
  .section {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
  }}
  .section h2 {{ font-size: 1.15rem; margin-bottom: 16px; }}

  /* Category bars */
  .cat-bar-row {{
    display: flex;
    align-items: center;
    margin-bottom: 10px;
    gap: 10px;
  }}
  .cat-bar-label {{ width: 200px; font-size: 0.85rem; text-align: right; color: var(--text2); flex-shrink: 0; }}
  .cat-bar-track {{ flex: 1; height: 24px; background: var(--surface2); border-radius: 4px; overflow: hidden; }}
  .cat-bar-fill {{ height: 100%; border-radius: 4px; display: flex; align-items: center; padding-left: 8px; font-size: 0.75rem; font-weight: 600; min-width: fit-content; }}
  .cat-bar-count {{ width: 50px; font-size: 0.85rem; color: var(--text2); text-align: right; flex-shrink: 0; }}

  /* Top domains */
  .domain-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 8px;
  }}
  .domain-item {{
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--surface2);
    border-radius: 6px;
    font-size: 0.85rem;
  }}
  .domain-item .count {{ color: var(--accent); font-weight: 600; }}

  /* Filters */
  .filters {{
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    align-items: center;
  }}
  .filters input, .filters select {{
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.85rem;
  }}
  .filters input {{ width: 260px; }}
  .filters select {{ min-width: 160px; }}

  /* Table */
  .table-wrap {{ overflow-x: auto; }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }}
  th {{
    text-align: left;
    padding: 10px 8px;
    background: var(--surface2);
    color: var(--text2);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    position: sticky;
    top: 0;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }}
  th:hover {{ color: var(--text); }}
  td {{
    padding: 8px;
    border-bottom: 1px solid var(--border);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }}
  tr:hover {{ background: var(--surface2); }}
  .domain {{ color: var(--accent); font-weight: 500; }}
  .name {{ color: var(--blue); }}
  .value {{ color: var(--text2); font-family: monospace; font-size: 0.78rem; }}
  .empty {{ color: #555; font-style: italic; }}

  /* Flags & badges */
  .flag {{
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    margin-right: 3px;
  }}
  .flag.secure {{ background: rgba(46,204,113,0.15); color: var(--green); }}
  .flag.httponly {{ background: rgba(52,152,219,0.15); color: var(--blue); }}
  .flag.samesite {{ background: rgba(149,165,166,0.1); color: var(--text2); }}
  .cat-badge {{
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
  }}

  .footer {{ text-align: center; color: var(--text2); font-size: 0.78rem; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }}

  /* Privacy insights */
  .insights-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 14px;
  }}
  .insight {{
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    background: var(--surface2);
    border-radius: 8px;
    border-left: 3px solid var(--border);
  }}
  .insight.warn {{ border-left-color: var(--orange); }}
  .insight.bad {{ border-left-color: var(--red); }}
  .insight.ok {{ border-left-color: var(--green); }}
  .insight.info {{ border-left-color: var(--blue); }}
  .insight .insight-icon {{ font-size: 1.3rem; flex-shrink: 0; margin-top: 1px; }}
  .insight .insight-body {{ flex: 1; }}
  .insight .insight-title {{ font-weight: 600; font-size: 0.88rem; margin-bottom: 2px; }}
  .insight .insight-desc {{ font-size: 0.8rem; color: var(--text2); line-height: 1.4; }}
  .insight .insight-count {{ font-size: 1.4rem; font-weight: 700; flex-shrink: 0; text-align: right; min-width: 48px; }}
  .insight.warn .insight-count {{ color: var(--orange); }}
  .insight.bad .insight-count {{ color: var(--red); }}
  .insight.ok .insight-count {{ color: var(--green); }}
  .insight.info .insight-count {{ color: var(--blue); }}
  .fp-bar {{ display: flex; height: 20px; border-radius: 4px; overflow: hidden; margin-top: 8px; }}
  .fp-bar .fp {{ background: var(--green); }}
  .fp-bar .tp {{ background: var(--red); }}
  .fp-legend {{ display: flex; gap: 16px; margin-top: 6px; font-size: 0.78rem; color: var(--text2); }}
  .fp-legend span::before {{ content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }}
  .fp-legend .l-fp::before {{ background: var(--green); }}
  .fp-legend .l-tp::before {{ background: var(--red); }}

  /* Worst offenders */
  .offender {{
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface2);
    border-radius: 8px;
    margin-bottom: 8px;
  }}
  .offender .rank {{
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text2);
    min-width: 24px;
    text-align: center;
  }}
  .offender .of-domain {{
    font-weight: 600;
    color: var(--accent);
    min-width: 200px;
    font-size: 0.88rem;
  }}
  .offender .of-bar-track {{
    flex: 1;
    height: 18px;
    background: var(--bg);
    border-radius: 3px;
    overflow: hidden;
  }}
  .offender .of-bar-fill {{
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--orange), var(--red));
  }}
  .offender .of-count {{
    font-size: 0.78rem;
    color: var(--text2);
    min-width: 60px;
    text-align: right;
  }}
  .offender .of-reasons {{
    font-size: 0.72rem;
    color: var(--text2);
    min-width: 280px;
  }}
  .offender .of-reasons span {{
    display: inline-block;
    background: rgba(231,76,60,0.12);
    color: var(--red);
    padding: 1px 6px;
    border-radius: 3px;
    margin: 1px 2px;
    font-size: 0.68rem;
  }}
</style>
</head>
<body>

<h1><span class="icon">🍪</span> Cookie Tracker Report</h1>
<p class="subtitle">Generated on {now_str} · Scanned {len(all_browser_data)} browser profile(s)</p>

<!-- Summary cards -->
<div class="cards">
  <div class="card">
    <div class="label">Total Cookies</div>
    <div class="val">{total_cookies}</div>
  </div>
  <div class="card">
    <div class="label">Unique Domains</div>
    <div class="val">{len(domain_counts)}</div>
  </div>
  <div class="card">
    <div class="label">Tracking / Ads</div>
    <div class="val {'risk-low' if risk_pct < 30 else 'risk-med' if risk_pct < 60 else 'risk-high'}">{risky_count} <span style="font-size:0.9rem">({risk_pct:.0f}%)</span></div>
  </div>
  <div class="card">
    <div class="label">Secure</div>
    <div class="val">{secure_count}</div>
  </div>
  <div class="card">
    <div class="label">HttpOnly</div>
    <div class="val">{httponly_count}</div>
  </div>
  <div class="card">
    <div class="label">Session / Persistent</div>
    <div class="val" style="font-size:1.3rem">{session_count} / {persistent_count}</div>
  </div>
</div>

<!-- Privacy Insights -->
<div class="section">
  <h2>Privacy Insights</h2>
  <div class="insights-grid">
    <div class="insight {'bad' if len(stale_cookies) > 50 else 'warn' if len(stale_cookies) > 10 else 'ok'}">
      <div class="insight-body">
        <div class="insight-title">Stale Cookies</div>
        <div class="insight-desc">Not accessed in 30+ days. Dead weight or forgotten trackers.</div>
      </div>
      <div class="insight-count">{len(stale_cookies)}</div>
    </div>
    <div class="insight {'bad' if len(long_lived_cookies) > 50 else 'warn' if len(long_lived_cookies) > 20 else 'ok'}">
      <div class="insight-body">
        <div class="insight-title">Long-Lived Cookies</div>
        <div class="insight-desc">Expiry over 1 year from now. Persistent tracking risk.</div>
      </div>
      <div class="insight-count">{len(long_lived_cookies)}</div>
    </div>
    <div class="insight {'bad' if len(insecure_cookies) > total_cookies * 0.5 else 'warn' if len(insecure_cookies) > 10 else 'ok'}">
      <div class="insight-body">
        <div class="insight-title">Missing Secure Flag</div>
        <div class="insight-desc">Sent over plain HTTP too. Vulnerable to interception.</div>
      </div>
      <div class="insight-count">{len(insecure_cookies)}</div>
    </div>
    <div class="insight {'warn' if len(no_httponly_cookies) > total_cookies * 0.5 else 'info'}">
      <div class="insight-body">
        <div class="insight-title">Missing HttpOnly</div>
        <div class="insight-desc">Readable by JavaScript. XSS attack surface.</div>
      </div>
      <div class="insight-count">{len(no_httponly_cookies)}</div>
    </div>
    <div class="insight {'bad' if len(samesite_none_cookies) > 30 else 'warn' if len(samesite_none_cookies) > 5 else 'ok'}">
      <div class="insight-body">
        <div class="insight-title">SameSite=None</div>
        <div class="insight-desc">Explicitly sent cross-site. These follow you across websites.</div>
      </div>
      <div class="insight-count">{len(samesite_none_cookies)}</div>
    </div>
    <div class="insight info">
      <div class="insight-body">
        <div class="insight-title">First-Party vs Third-Party</div>
        <div class="insight-desc">How much of your cookie jar is sites you visit vs companies watching you.</div>
        <div class="fp-bar">
          <div class="fp" style="width:{first_party_count / total_cookies * 100 if total_cookies else 0:.1f}%"></div>
          <div class="tp" style="width:{third_party_count / total_cookies * 100 if total_cookies else 0:.1f}%"></div>
        </div>
        <div class="fp-legend">
          <span class="l-fp">First-party: {first_party_count} ({first_party_count / total_cookies * 100 if total_cookies else 0:.0f}%)</span>
          <span class="l-tp">Third-party: {third_party_count} ({third_party_count / total_cookies * 100 if total_cookies else 0:.0f}%)</span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Worst Offenders -->
<div class="section">
  <h2>Worst Offenders</h2>
  <p style="color:var(--text2);font-size:0.82rem;margin-bottom:14px">Domains ranked by suspicion score: tracking category, cross-site cookies, missing security flags, long expiry.</p>
  {"".join(f'''<div class="offender">
    <div class="rank">{i+1}</div>
    <div class="of-domain">{html_lib.escape(o["domain"])}</div>
    <div class="of-bar-track"><div class="of-bar-fill" style="width:{o["score"]/max_score*100:.0f}%"></div></div>
    <div class="of-count">{o["count"]} cookie{"s" if o["count"] != 1 else ""}</div>
    <div class="of-reasons">{"".join(f"<span>{html_lib.escape(r)}</span>" for r in sorted(o["reasons"]))}</div>
  </div>''' for i, o in enumerate(worst_offenders))}
</div>

<!-- Category breakdown -->
<div class="section">
  <h2>Category Breakdown</h2>
  {"".join(f'''
  <div class="cat-bar-row">
    <div class="cat-bar-label">{cat}</div>
    <div class="cat-bar-track">
      <div class="cat-bar-fill" style="width:{max(cnt/total_cookies*100, 3):.1f}%;background:{cat_colors.get(cat, '#95a5a6')}">{cnt}</div>
    </div>
    <div class="cat-bar-count">{cnt/total_cookies*100:.0f}%</div>
  </div>''' for cat, cnt in cat_items)}
</div>

<!-- Top domains -->
<div class="section">
  <h2>Top Domains (by cookie count)</h2>
  <div class="domain-grid">
    {"".join(f'<div class="domain-item"><span>{html_lib.escape(d)}</span><span class="count">{cnt}</span></div>' for d, cnt in top_domains)}
  </div>
</div>

<!-- Full cookie table -->
<div class="section">
  <h2>All Cookies</h2>
  <div class="filters">
    <input type="text" id="search" placeholder="Search domain or cookie name..." oninput="filterTable()">
    <select id="catFilter" onchange="filterTable()">
      <option value="">All Categories</option>
      {"".join(f'<option value="{cat}">{cat} ({cnt})</option>' for cat, cnt in cat_items)}
    </select>
    <select id="browserFilter" onchange="filterTable()">
      <option value="">All Browsers</option>
      {"".join(f'<option value="{b} ({p})">{b} ({p})</option>' for b, p, _ in all_browser_data)}
    </select>
  </div>
  <div class="table-wrap">
    <table id="cookieTable">
      <thead>
        <tr>
          <th onclick="sortTable(0)">Domain</th>
          <th onclick="sortTable(1)">Name</th>
          <th onclick="sortTable(2)">Value</th>
          <th onclick="sortTable(3)">Path</th>
          <th onclick="sortTable(4)">Expires</th>
          <th>Flags</th>
          <th onclick="sortTable(6)">Category</th>
          <th onclick="sortTable(7)">Created</th>
          <th onclick="sortTable(8)">Last Access</th>
          <th onclick="sortTable(9)">Browser</th>
        </tr>
      </thead>
      <tbody>
        {"".join(table_rows)}
      </tbody>
    </table>
  </div>
</div>

<div class="footer">
  Cookie Tracker · Run <code>python3 cookie_tracker.py</code> to regenerate
</div>

<script>
function filterTable() {{
  const search = document.getElementById('search').value.toLowerCase();
  const cat = document.getElementById('catFilter').value;
  const browser = document.getElementById('browserFilter').value;
  const rows = document.querySelectorAll('#cookieTable tbody tr');
  rows.forEach(row => {{
    const domain = row.cells[0].textContent.toLowerCase();
    const name = row.cells[1].textContent.toLowerCase();
    const rowCat = row.dataset.category;
    const rowBrowser = row.dataset.browser;
    let show = true;
    if (search && !domain.includes(search) && !name.includes(search)) show = false;
    if (cat && rowCat !== cat) show = false;
    if (browser && rowBrowser !== browser) show = false;
    row.style.display = show ? '' : 'none';
  }});
}}

let sortDir = {{}};
function sortTable(col) {{
  const table = document.getElementById('cookieTable');
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  sortDir[col] = !sortDir[col];
  rows.sort((a, b) => {{
    const va = a.cells[col].textContent.trim();
    const vb = b.cells[col].textContent.trim();
    return sortDir[col] ? va.localeCompare(vb) : vb.localeCompare(va);
  }});
  rows.forEach(r => tbody.appendChild(r));
}}
</script>
</body>
</html>"""

    with open(output_path, "w") as f:
        f.write(report_html)
    return output_path


# --- Main ---

def derive_first_party_domains(all_data):
    """Derive first-party domains from cookies without leading dots (direct visits)."""
    domains = set()
    for _, _, cookies in all_data:
        for c in cookies:
            d = c["domain"].lower().lstrip(".")
            # Extract registrable domain (last two parts, or three for co.uk etc.)
            parts = d.split(".")
            if len(parts) >= 2:
                domains.add(".".join(parts[-2:]))
    return domains


def classify_all_cookies(all_data, first_party_domains):
    """Classify all cookies now that we know the full set of first-party domains."""
    for _, _, cookies in all_data:
        for c in cookies:
            c["category"] = classify_cookie(c["domain"], c["name"], first_party_domains)


def main():
    parser = argparse.ArgumentParser(description="Scan browser cookies and generate a report.")
    parser.add_argument("-o", "--output", default=os.path.expanduser("~/cookie_report.html"),
                        help="Output file path (default: ~/cookie_report.html)")
    parser.add_argument("--json", dest="json_output", metavar="PATH",
                        help="Also export raw cookie data as JSON")
    args = parser.parse_args()

    # Guard against running as root (Path.home() would be /root)
    if os.geteuid() == 0 and "SUDO_USER" in os.environ:
        print("⚠ Running with sudo — Path.home() points to /root, not your user home.")
        print(f"  Run without sudo: python3 {sys.argv[0]}")
        sys.exit(1)

    print("🍪 Cookie Tracker — Scanning browser databases...\n")

    all_data = []

    # Chrome-based
    chrome_dbs = find_chrome_cookie_dbs()
    for browser, profile, path in chrome_dbs:
        print(f"  📂 {browser} [{profile}] → {path}")
        cookies = read_chrome_cookies(path)
        print(f"     Found {len(cookies)} cookies")
        if cookies:
            all_data.append((browser, profile, cookies))

    # Firefox
    ff_dbs = find_firefox_cookie_dbs()
    for browser, profile, path in ff_dbs:
        print(f"  📂 {browser} [{profile}] → {path}")
        cookies = read_firefox_cookies(path)
        print(f"     Found {len(cookies)} cookies")
        if cookies:
            all_data.append((browser, profile, cookies))

    if not all_data:
        print("\n⚠ No browser cookie databases found!")
        print("  Make sure Chrome, Chromium, Brave, Edge, or Firefox is installed.")
        print("  Close the browser first if cookies DB is locked.")
        sys.exit(1)

    # Classify cookies with full domain context
    first_party = derive_first_party_domains(all_data)
    classify_all_cookies(all_data, first_party)

    total = sum(len(c) for _, _, c in all_data)
    print(f"\n✅ Total: {total} cookies from {len(all_data)} profile(s)")

    generate_report(all_data, args.output)
    print(f"📊 Report saved to: {args.output}")
    print(f"   Open with: xdg-open {args.output}")

    if args.json_output:
        all_cookies = []
        for browser, profile, cookies in all_data:
            for c in cookies:
                c["browser"] = f"{browser} ({profile})"
                all_cookies.append(c)
        with open(args.json_output, "w") as f:
            json.dump(all_cookies, f, indent=2)
        print(f"📄 JSON saved to: {args.json_output}")


if __name__ == "__main__":
    main()
