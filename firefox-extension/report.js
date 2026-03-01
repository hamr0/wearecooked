// --- Classification data ---

const TRACKER_DOMAINS = [
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
];

const PURPOSE_DOMAINS = {
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
};

const TRACKER_PATTERNS = {
  "Analytics / Tracking": [
    "_ga", "_gid", "_gat", "_gcl", "__utm", "amplitude", "mixpanel",
    "mp_", "ahoy_", "_hjid", "_hjSession", "hubspot", "_fbp", "_fbc",
    "intercom", "ajs_", "segment", "_clck", "_clsk", "clarity",
    "plausible", "matomo", "_pk_", "piwik",
  ],
  "Advertising": [
    "IDE", "DSID", "NID", "ANID", "1P_JAR", "APISID", "SSID",
    "fr", "xs", "datr", "sb",
    "muc_ads", "personalization_id",
    "_rdt_uuid", "li_sugr",
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
    "lidc", "player",
  ],
  "E-commerce / Payment": [
    "cart", "basket", "checkout", "stripe", "paypal",
    "shopify", "shop_", "_shopify",
    "wishlist", "recently_viewed", "product",
  ],
};

const RISKY_CATEGORIES = new Set([
  "Analytics / Tracking", "Advertising",
  "Third-party (uncategorized)", "Social Media Tracking",
]);

const CAT_COLORS = {
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
};

// --- Classification ---

function deriveFirstPartyDomains(cookies) {
  const domains = new Set();
  for (const c of cookies) {
    const d = c.domain.toLowerCase().replace(/^\./, "");
    const parts = d.split(".");
    if (parts.length >= 2) {
      domains.add(parts.slice(-2).join("."));
    }
  }
  return domains;
}

function classifyCookie(domain, name, firstPartyDomains) {
  const nameLower = name.toLowerCase();
  const domainLower = domain.toLowerCase().replace(/^\./, "");

  // Tracker domains
  for (const td of TRACKER_DOMAINS) {
    if (domainLower.includes(td)) {
      return ["ad", "syndication", "doubleclick"].some(kw => td.includes(kw))
        ? "Advertising" : "Analytics / Tracking";
    }
  }

  // Purpose domains
  for (const [category, domains] of Object.entries(PURPOSE_DOMAINS)) {
    for (const pd of domains) {
      if (domainLower.includes(pd)) return category;
    }
  }

  // Name patterns
  for (const [category, patterns] of Object.entries(TRACKER_PATTERNS)) {
    for (const pattern of patterns) {
      if (nameLower.includes(pattern.toLowerCase())) return category;
    }
  }

  // Third-party check
  if (firstPartyDomains) {
    const isFirstParty = [...firstPartyDomains].some(
      fp => domainLower === fp || domainLower.endsWith("." + fp)
    );
    if (!isFirstParty) return "Third-party (uncategorized)";
  }

  return "Functional / Other";
}

// --- Helpers ---

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

function safeSetHTML(target, html) {
  while (target.firstChild) target.removeChild(target.firstChild);
  var parsed = new DOMParser().parseFromString(html, "text/html");
  while (parsed.body.firstChild) {
    target.appendChild(document.adoptNode(parsed.body.firstChild));
  }
}

function fmtDate(epoch) {
  if (!epoch) return "\u2014";
  const d = new Date(epoch * 1000);
  if (d.getFullYear() < 2000) return "\u2014";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function countBy(arr, fn) {
  const counts = {};
  for (const item of arr) {
    const key = fn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

// --- Report rendering ---

function renderReport(cookies) {
  const now = new Date();
  const nowStr = now.toISOString().replace("T", " ").slice(0, 19);
  const total = cookies.length;
  if (total === 0) {
    document.getElementById("loading").textContent = "No cookies found.";
    return;
  }

  // Classify
  const firstParty = deriveFirstPartyDomains(cookies);
  for (const c of cookies) {
    c.category = classifyCookie(c.domain, c.name, firstParty);
    c.expiresStr = c.expirationDate ? fmtDate(c.expirationDate) : "Session";
    c.valueShort = c.value ? (c.value.length > 120 ? c.value.slice(0, 120) + "..." : c.value) : "";
    c.sameSiteLabel = { "no_restriction": "None", "lax": "Lax", "strict": "Strict", "unspecified": "Unspecified" }[c.sameSite] || c.sameSite || "Unspecified";
  }

  // Stats
  const catCounts = countBy(cookies, c => c.category);
  const domainCounts = countBy(cookies, c => c.domain);
  const topDomains = sortedEntries(domainCounts).slice(0, 20);
  const secureCount = cookies.filter(c => c.secure).length;
  const httpOnlyCount = cookies.filter(c => c.httpOnly).length;
  const sessionCount = cookies.filter(c => !c.expirationDate).length;
  const persistentCount = total - sessionCount;
  const riskyCount = cookies.filter(c => RISKY_CATEGORIES.has(c.category)).length;
  const riskPct = (riskyCount / total * 100);

  // Privacy insights
  const nowEpoch = now.getTime() / 1000;
  const staleCookies = cookies.filter(c => {
    if (!c.expirationDate) return false;
    // No lastAccessed in extension API, use expiration as proxy:
    // if it expired already, it's stale
    return c.expirationDate < nowEpoch;
  });
  const longLived = cookies.filter(c => {
    if (!c.expirationDate) return false;
    return (c.expirationDate - nowEpoch) > 365 * 86400;
  });
  const insecure = cookies.filter(c => !c.secure);
  const noHttpOnly = cookies.filter(c => !c.httpOnly);
  const sameSiteNone = cookies.filter(c => c.sameSite === "no_restriction");
  const thirdPartyCount = cookies.filter(c => RISKY_CATEGORIES.has(c.category)).length;
  const firstPartyCount = total - thirdPartyCount;

  // Worst offenders
  const domainScores = {};
  for (const c of cookies) {
    const d = c.domain.toLowerCase().replace(/^\./, "");
    if (!domainScores[d]) domainScores[d] = { domain: d, count: 0, score: 0, reasons: new Set() };
    const ds = domainScores[d];
    ds.count++;
    if (RISKY_CATEGORIES.has(c.category)) {
      ds.score += 3;
      ds.reasons.add(c.category);
    }
    if (c.sameSite === "no_restriction") {
      ds.score += 2;
      ds.reasons.add("Cross-site (SameSite=None)");
    }
    if (!c.secure) {
      ds.score += 1;
      ds.reasons.add("Missing Secure flag");
    }
    if (c.expirationDate && (c.expirationDate - nowEpoch) > 365 * 86400) {
      ds.score += 2;
      ds.reasons.add("Long-lived (1yr+)");
    }
  }
  const worstOffenders = Object.values(domainScores)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const maxScore = worstOffenders[0]?.score || 1;

  // Category items sorted
  const catItems = sortedEntries(catCounts);

  // Risk class
  const riskClass = riskPct < 30 ? "risk-low" : riskPct < 60 ? "risk-med" : "risk-high";

  // Insight severity helper
  function insightClass(count, warnAt, badAt) {
    if (count > badAt) return "bad";
    if (count > warnAt) return "warn";
    return "ok";
  }

  // Build HTML
  const top8 = worstOffenders.slice(0, 8);
  const html = `
<h1><span class="icon">&#128373;</span> wearecooked</h1>
<p class="subtitle">${esc(nowStr)} &middot; ${total} cookies &middot; ${Object.keys(domainCounts).length} domains</p>

<div class="cards">
  <div class="card"><div class="label">Total Cookies</div><div class="val">${total}</div></div>
  <div class="card"><div class="label">Unique Domains</div><div class="val">${Object.keys(domainCounts).length}</div></div>
  <div class="card"><div class="label">Tracking / Ads</div><div class="val ${riskClass}">${riskyCount} <span style="font-size:0.9rem">(${riskPct.toFixed(0)}%)</span></div></div>
  <div class="card"><div class="label">Secure (HTTPS)</div><div class="val">${secureCount} <span style="font-size:0.9rem">/ ${total - secureCount} not</span></div></div>
  <div class="card"><div class="label">Session / Persistent</div><div class="val" style="font-size:1.3rem">${sessionCount} / ${persistentCount}</div></div>
</div>

<div class="tag-row">
  ${[["Analytics / Tracking"], ["Advertising"], ["Social Media Tracking"], ["E-commerce / Payment"], ["CDN / Performance"], ["Session / Auth"]].map(([cat]) => {
    const cnt = catCounts[cat] || 0;
    if (cnt === 0) return "";
    return '<span class="tag-chip" style="border-color:' + (CAT_COLORS[cat] || "#95a5a6") + ';color:' + (CAT_COLORS[cat] || "#95a5a6") + '">' + esc(cat.replace(" / ", "/")) + ' <strong>' + cnt + '</strong></span>';
  }).join("")}
</div>

<div class="cta-banner">
  <div class="cta-left">
    <div class="cta-title">${riskyCount > 0 ? riskyCount + ' tracking cookie' + (riskyCount !== 1 ? 's' : '') + ' found' : 'Manage your cookies'}</div>
    <div class="cta-desc">${riskyCount > 0 ? 'Delete trackers with one click. Your logins and preferences stay safe.' : 'Review and selectively remove cookies by category.'}</div>
  </div>
  <a href="cleaner.html" class="cta-btn">${riskyCount > 0 ? 'Clean Cookies' : 'Open Cleaner'} &rarr;</a>
</div>

<div class="section">
  <div class="fp-standalone">
    <div class="fp-label">First-party vs third-party</div>
    <div class="fp-bar">
      <div class="fp" style="width:${total ? (firstPartyCount/total*100).toFixed(1) : 0}%"></div>
      <div class="tp" style="width:${total ? (thirdPartyCount/total*100).toFixed(1) : 0}%"></div>
    </div>
    <div class="fp-legend">
      <span class="l-fp">First-party: ${firstPartyCount} (${total ? (firstPartyCount/total*100).toFixed(0) : 0}%)</span>
      <span class="l-tp">Third-party: ${thirdPartyCount} (${total ? (thirdPartyCount/total*100).toFixed(0) : 0}%)</span>
    </div>
  </div>
  <div class="insights-row">
    <div class="insight ${insightClass(staleCookies.length, 10, 50)}">
      <div class="insight-body">
        <div class="insight-title">Expired</div>
        <div class="insight-desc">Dead weight — already expired but still stored.</div>
      </div>
      <div class="insight-count">${staleCookies.length}</div>
    </div>
    <div class="insight ${insightClass(longLived.length, 20, 50)}">
      <div class="insight-body">
        <div class="insight-title">Long-Lived</div>
        <div class="insight-desc">Persistent trackers — expiry over 1 year out.</div>
      </div>
      <div class="insight-count">${longLived.length}</div>
    </div>
    <div class="insight ${insightClass(sameSiteNone.length, 5, 30)}">
      <div class="insight-body">
        <div class="insight-title">Cross-Site</div>
        <div class="insight-desc">SameSite=None — follow you across websites.</div>
      </div>
      <div class="insight-count">${sameSiteNone.length}</div>
    </div>
  </div>
</div>

<div class="section">
  <h2>Worst Offenders</h2>
  ${top8.map((o, i) => `<div class="offender">
    <div class="rank">${i+1}</div>
    <div class="of-domain">${esc(o.domain)}</div>
    <div class="of-bar-track"><div class="of-bar-fill" style="width:${(o.score/maxScore*100).toFixed(0)}%"></div></div>
    <div class="of-count">${o.count}</div>
    <div class="of-reasons">${[...o.reasons].sort().map(r => `<span>${esc(r)}</span>`).join("")}</div>
  </div>`).join("")}
</div>

<div class="section">
  <h2>Categories</h2>
  ${catItems.map(([cat, cnt]) => `<div class="cat-bar-row">
    <div class="cat-bar-label">${esc(cat)}</div>
    <div class="cat-bar-track">
      <div class="cat-bar-fill" style="width:${Math.max(cnt/total*100, 3).toFixed(1)}%;background:${CAT_COLORS[cat] || "#95a5a6"}">${cnt}</div>
    </div>
    <div class="cat-bar-count">${(cnt/total*100).toFixed(0)}%</div>
  </div>`).join("")}
</div>

<div class="section">
  <div class="table-toggle" id="table-toggle">
    <h2>All Cookies</h2>
    <span class="toggle-hint">${total} cookies &middot; click to expand</span>
  </div>
  <div id="table-content" style="display:none">
    <div class="filters">
      <input type="text" id="search" placeholder="Search domain or cookie name..." oninput="filterTable()">
      <select id="catFilter" onchange="filterTable()">
        <option value="">All Categories</option>
        ${catItems.map(([cat, cnt]) => `<option value="${esc(cat)}">${esc(cat)} (${cnt})</option>`).join("")}
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
          </tr>
        </thead>
        <tbody>
          ${cookies.map(c => {
            const cat = c.category;
            const color = CAT_COLORS[cat] || "#95a5a6";
            const valDisplay = c.valueShort ? esc(c.valueShort) : '<span class="empty">empty</span>';
            return `<tr data-category="${esc(cat)}">
              <td class="domain">${esc(c.domain)}</td>
              <td class="name">${esc(c.name)}</td>
              <td class="value" title="${esc(c.valueShort)}">${valDisplay}</td>
              <td>${esc(c.path)}</td>
              <td>${c.expiresStr}</td>
              <td class="flags">
                ${c.secure ? '<span class="flag secure">Secure</span>' : ''}
                ${c.httpOnly ? '<span class="flag httponly">HttpOnly</span>' : ''}
                <span class="flag samesite">SS:${c.sameSiteLabel}</span>
              </td>
              <td><span class="cat-badge" style="background:${color}">${esc(cat)}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="footer">wearecooked &middot; <a href="cleaner.html" style="color:var(--accent);text-decoration:none">Cookie Cleaner</a></div>`;

  document.getElementById("loading").style.display = "none";
  const reportEl = document.getElementById("report");
  safeSetHTML(reportEl, html);
  reportEl.style.display = "block";

  // Table toggle
  const toggle = document.getElementById("table-toggle");
  const content = document.getElementById("table-content");
  if (toggle && content) {
    toggle.addEventListener("click", function() {
      const open = content.style.display !== "none";
      content.style.display = open ? "none" : "block";
      toggle.querySelector(".toggle-hint").textContent = open
        ? total + " cookies \u00b7 click to expand"
        : "click to collapse";
    });
  }
}

// --- Table interactivity ---

function filterTable() {
  const search = document.getElementById("search").value.toLowerCase();
  const cat = document.getElementById("catFilter").value;
  const rows = document.querySelectorAll("#cookieTable tbody tr");
  rows.forEach(row => {
    const domain = row.cells[0].textContent.toLowerCase();
    const name = row.cells[1].textContent.toLowerCase();
    const rowCat = row.dataset.category;
    let show = true;
    if (search && !domain.includes(search) && !name.includes(search)) show = false;
    if (cat && rowCat !== cat) show = false;
    row.style.display = show ? "" : "none";
  });
}

const sortDir = {};
function sortTable(col) {
  const table = document.getElementById("cookieTable");
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  sortDir[col] = !sortDir[col];
  rows.sort((a, b) => {
    const va = a.cells[col].textContent.trim();
    const vb = b.cells[col].textContent.trim();
    return sortDir[col] ? va.localeCompare(vb) : vb.localeCompare(va);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// --- Init (Firefox: permissions granted at install) ---
function showError(msg) {
  const el = document.getElementById("scan-status") || document.getElementById("loading");
  el.textContent = msg;
  el.style.color = "#e74c3c";
}

getAllCookies().then(cookies => {
  try { renderReport(cookies); } catch (e) { showError("Render error: " + e.message); }
}).catch(err => {
  showError(err.message || "Failed to load cookies.");
});
