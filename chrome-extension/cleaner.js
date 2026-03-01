// --- Classification data (same as report.js) ---
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
    if (parts.length >= 2) domains.add(parts.slice(-2).join("."));
  }
  return domains;
}

function classifyCookie(domain, name, firstPartyDomains) {
  const nameLower = name.toLowerCase();
  const domainLower = domain.toLowerCase().replace(/^\./, "");
  for (const td of TRACKER_DOMAINS) {
    if (domainLower.includes(td)) {
      return ["ad", "syndication", "doubleclick"].some(kw => td.includes(kw))
        ? "Advertising" : "Analytics / Tracking";
    }
  }
  for (const [category, domains] of Object.entries(PURPOSE_DOMAINS)) {
    for (const pd of domains) {
      if (domainLower.includes(pd)) return category;
    }
  }
  for (const [category, patterns] of Object.entries(TRACKER_PATTERNS)) {
    for (const pattern of patterns) {
      if (nameLower.includes(pattern.toLowerCase())) return category;
    }
  }
  if (firstPartyDomains) {
    const isFirstParty = [...firstPartyDomains].some(
      fp => domainLower === fp || domainLower.endsWith("." + fp)
    );
    if (!isFirstParty) return "Third-party (uncategorized)";
  }
  return "Functional / Other";
}

function esc(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// --- State ---
let allCookies = [];
let selectedIds = new Set();

// --- Delete a single cookie ---
async function deleteCookie(cookie) {
  const protocol = cookie.secure ? "https" : "http";
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain;
  const url = protocol + "://" + domain + cookie.path;
  return chrome.cookies.remove({ url: url, name: cookie.name, storeId: cookie.storeId });
}

// --- Render ---
function renderCleaner(cookies) {
  allCookies = cookies;
  const fp = deriveFirstPartyDomains(cookies);
  for (let i = 0; i < cookies.length; i++) {
    cookies[i]._idx = i;
    cookies[i].category = classifyCookie(cookies[i].domain, cookies[i].name, fp);
  }

  // Group by category
  const groups = {};
  for (const c of cookies) {
    if (!groups[c.category]) groups[c.category] = [];
    groups[c.category].push(c);
  }

  // Sort: risky first, then by count desc
  const catOrder = Object.entries(groups).sort(function(a, b) {
    const aRisky = RISKY_CATEGORIES.has(a[0]) ? 0 : 1;
    const bRisky = RISKY_CATEGORIES.has(b[0]) ? 0 : 1;
    if (aRisky !== bRisky) return aRisky - bRisky;
    return b[1].length - a[1].length;
  });

  // Pre-select risky categories
  selectedIds.clear();
  for (const c of cookies) {
    if (RISKY_CATEGORIES.has(c.category)) selectedIds.add(c._idx);
  }

  const riskyCount = cookies.filter(function(c) { return RISKY_CATEGORIES.has(c.category); }).length;
  const safeCount = cookies.length - riskyCount;

  // Build HTML — no inline handlers
  var html = '<h1><span class="icon">&#128373;</span> wearecooked ' +
    '<span style="font-size:0.9rem;color:var(--text2);font-weight:400">\u2014 Cookie Cleaner</span></h1>' +
    '<p class="subtitle">' + cookies.length + ' cookies scanned &middot; ' +
    riskyCount + ' trackers found &middot; ' + safeCount + ' kept safe</p>' +
    '<div class="protected-note">' +
    'Session / Auth, Preference, CDN, Captcha, E-commerce, and Functional cookies are ' +
    '<strong>not selected</strong> by default. Your logins are safe.</div>' +
    '<div id="result-banner" class="result-banner"></div>' +
    '<div class="summary-bar" id="summary-bar"></div>' +
    '<div class="cleaner-controls">' +
    '<button class="btn-nuke" id="btn-delete">Delete Selected (<span id="sel-count">' + selectedIds.size + '</span>)</button>' +
    '<button class="btn-safe" id="btn-risky-only">Select Trackers Only</button>' +
    '<button class="btn-select" id="btn-all">Select All</button>' +
    '<button class="btn-select" id="btn-none">Deselect All</button>' +
    '</div>';

  for (var g = 0; g < catOrder.length; g++) {
    var cat = catOrder[g][0];
    var items = catOrder[g][1];
    var isRisky = RISKY_CATEGORIES.has(cat);
    var riskLabel = isRisky ? "risky" : (cat === "Functional / Other" ? "warn" : "safe");
    var riskText = isRisky ? "Tracker" : "Safe to keep";
    var color = CAT_COLORS[cat] || "#95a5a6";
    var catId = cat.replace(/[^a-zA-Z]/g, "");

    html += '<div class="cat-group">' +
      '<div class="cat-header" data-catid="' + catId + '">' +
      '<div class="cat-left">' +
      '<input type="checkbox" id="cat-cb-' + catId + '" data-catid="' + catId + '" class="cat-checkbox"' +
      (items.every(function(c) { return selectedIds.has(c._idx); }) ? " checked" : "") + '>' +
      '<span class="cat-badge" style="background:' + color + '">' + esc(cat) + '</span>' +
      '<span class="cat-name">' + items.length + ' cookie' + (items.length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<span class="cat-risk ' + riskLabel + '">' + riskText + '</span>' +
      '</div></div>' +
      '<div class="cat-body" id="cat-body-' + catId + '">';

    for (var j = 0; j < items.length; j++) {
      var c = items[j];
      html += '<div class="cookie-row">' +
        '<input type="checkbox" data-idx="' + c._idx + '" class="cookie-checkbox"' +
        (selectedIds.has(c._idx) ? " checked" : "") + '>' +
        '<span class="cookie-domain">' + esc(c.domain) + '</span>' +
        '<span class="cookie-name">' + esc(c.name) + '</span>' +
        '<span class="cookie-meta">' + (c.secure ? "Secure " : "") + (c.httpOnly ? "HttpOnly" : "") + '</span>' +
        '</div>';
    }
    html += '</div></div>';
  }

  html += '<div class="footer">wearecooked &middot; POC: Smart Cookie Cleaner</div>';

  document.getElementById("loading").style.display = "none";
  var app = document.getElementById("app");
  app.innerHTML = html;
  app.style.display = "block";
  updateSummary();
  bindEvents();
}

// --- Bind all events via addEventListener (CSP-safe) ---
function bindEvents() {
  // Delete button
  document.getElementById("btn-delete").addEventListener("click", confirmDelete);
  document.getElementById("btn-risky-only").addEventListener("click", selectRiskyOnly);
  document.getElementById("btn-all").addEventListener("click", selectAll);
  document.getElementById("btn-none").addEventListener("click", selectNone);

  // Category headers (toggle expand)
  var headers = document.querySelectorAll(".cat-header");
  for (var i = 0; i < headers.length; i++) {
    headers[i].addEventListener("click", function(e) {
      // Don't toggle if clicking the checkbox itself
      if (e.target.classList.contains("cat-checkbox")) return;
      var catId = this.getAttribute("data-catid");
      var body = document.getElementById("cat-body-" + catId);
      body.classList.toggle("open");
    });
  }

  // Category checkboxes
  var catCbs = document.querySelectorAll(".cat-checkbox");
  for (var i = 0; i < catCbs.length; i++) {
    catCbs[i].addEventListener("change", function(e) {
      e.stopPropagation();
      var catId = this.getAttribute("data-catid");
      var body = document.getElementById("cat-body-" + catId);
      var checkboxes = body.querySelectorAll(".cookie-checkbox");
      var checked = this.checked;
      for (var j = 0; j < checkboxes.length; j++) {
        var idx = parseInt(checkboxes[j].getAttribute("data-idx"));
        checkboxes[j].checked = checked;
        if (checked) selectedIds.add(idx); else selectedIds.delete(idx);
      }
      updateSummary();
    });
  }

  // Individual cookie checkboxes
  var cookieCbs = document.querySelectorAll(".cookie-checkbox");
  for (var i = 0; i < cookieCbs.length; i++) {
    cookieCbs[i].addEventListener("change", function() {
      var idx = parseInt(this.getAttribute("data-idx"));
      if (this.checked) selectedIds.add(idx); else selectedIds.delete(idx);
      updateCatCheckboxes();
      updateSummary();
    });
  }
}

function updateSummary() {
  var selCount = selectedIds.size;
  var kept = allCookies.length - selCount;
  var selEl = document.getElementById("sel-count");
  if (selEl) selEl.textContent = selCount;

  var authKept = 0;
  for (var i = 0; i < allCookies.length; i++) {
    if (!selectedIds.has(allCookies[i]._idx) && allCookies[i].category === "Session / Auth") authKept++;
  }

  var bar = document.getElementById("summary-bar");
  if (bar) {
    bar.innerHTML =
      '<span>Deleting: <strong style="color:var(--red)">' + selCount + '</strong></span>' +
      '<span>Keeping: <strong style="color:var(--green)">' + kept + '</strong></span>' +
      '<span>Logins protected: <strong style="color:var(--green)">' + authKept + '</strong></span>';
  }
}

function updateCatCheckboxes() {
  var groups = document.querySelectorAll(".cat-group");
  for (var i = 0; i < groups.length; i++) {
    var catCb = groups[i].querySelector(".cat-checkbox");
    var itemCbs = groups[i].querySelectorAll(".cookie-checkbox");
    if (catCb && itemCbs.length) {
      var allChecked = true, someChecked = false;
      for (var j = 0; j < itemCbs.length; j++) {
        if (itemCbs[j].checked) someChecked = true; else allChecked = false;
      }
      catCb.checked = allChecked;
      catCb.indeterminate = !allChecked && someChecked;
    }
  }
}

function selectAll() {
  for (var i = 0; i < allCookies.length; i++) selectedIds.add(allCookies[i]._idx);
  var cbs = document.querySelectorAll('#app input[type="checkbox"]');
  for (var i = 0; i < cbs.length; i++) cbs[i].checked = true;
  updateSummary();
}

function selectNone() {
  selectedIds.clear();
  var cbs = document.querySelectorAll('#app input[type="checkbox"]');
  for (var i = 0; i < cbs.length; i++) { cbs[i].checked = false; cbs[i].indeterminate = false; }
  updateSummary();
}

function selectRiskyOnly() {
  selectedIds.clear();
  for (var i = 0; i < allCookies.length; i++) {
    if (RISKY_CATEGORIES.has(allCookies[i].category)) selectedIds.add(allCookies[i]._idx);
  }
  var cbs = document.querySelectorAll(".cookie-checkbox");
  for (var i = 0; i < cbs.length; i++) {
    var idx = parseInt(cbs[i].getAttribute("data-idx"));
    cbs[i].checked = selectedIds.has(idx);
  }
  updateCatCheckboxes();
  updateSummary();
}

function confirmDelete() {
  if (selectedIds.size === 0) return;

  var authSelected = allCookies.filter(function(c) {
    return selectedIds.has(c._idx) && c.category === "Session / Auth";
  });
  var authKept = allCookies.filter(function(c) {
    return !selectedIds.has(c._idx) && c.category === "Session / Auth";
  });
  var warningHtml = authSelected.length > 0
    ? '<p style="color:var(--orange);font-weight:600">Warning: ' + authSelected.length +
      ' login/session cookie' + (authSelected.length !== 1 ? 's' : '') +
      ' selected. You may be logged out of some sites.</p>'
    : "";

  var overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML =
    '<div class="confirm-box">' +
    '<h3>Delete ' + selectedIds.size + ' cookies?</h3>' +
    '<p>This will permanently remove the selected cookies from your browser.</p>' +
    warningHtml +
    '<p>' + (allCookies.length - selectedIds.size) + ' cookies will be kept (including ' +
    authKept.length + ' login cookies).</p>' +
    '<div class="confirm-btns">' +
    '<button class="btn-cancel" id="confirm-cancel">Cancel</button>' +
    '<button class="btn-confirm-delete" id="confirm-go">Delete ' + selectedIds.size + ' Cookies</button>' +
    '</div></div>';

  document.body.appendChild(overlay);

  document.getElementById("confirm-cancel").addEventListener("click", function() {
    overlay.remove();
  });
  document.getElementById("confirm-go").addEventListener("click", function() {
    executeDelete(overlay);
  });
}

async function executeDelete(overlay) {
  var btn = document.getElementById("confirm-go");
  btn.textContent = "Deleting...";
  btn.disabled = true;

  var toDelete = allCookies.filter(function(c) { return selectedIds.has(c._idx); });
  var deleted = 0;
  var failed = 0;

  for (var i = 0; i < toDelete.length; i++) {
    try {
      await deleteCookie(toDelete[i]);
      deleted++;
    } catch (e) {
      failed++;
    }
  }

  overlay.remove();

  var banner = document.getElementById("result-banner");
  if (failed === 0) {
    banner.className = "result-banner success";
    banner.textContent = "Deleted " + deleted + " cookies. Your logins are intact. Rescan to verify.";
  } else {
    banner.className = "result-banner error";
    banner.textContent = "Deleted " + deleted + " cookies, " + failed + " failed. Some cookies may be protected by the browser.";
  }

  // Rescan after deletion
  try {
    var fresh = await getAllCookies();
    renderCleaner(fresh);
  } catch (e) { /* keep banner visible */ }
}

// --- Init ---
function showLoading() {
  var prompt = document.getElementById("scan-prompt");
  var status = document.getElementById("scan-status");
  if (prompt) prompt.style.display = "none";
  if (status) { status.style.display = "block"; status.textContent = "Scanning cookies..."; }
}

function showError(msg) {
  var loading = document.getElementById("loading");
  loading.style.display = "flex";
  var prompt = document.getElementById("scan-prompt");
  var status = document.getElementById("scan-status");
  if (prompt) prompt.style.display = "none";
  if (status) { status.style.display = "block"; status.textContent = msg; status.style.color = "#e74c3c"; }
}

getAllCookies().then(function(cookies) {
  showLoading();
  try { renderCleaner(cookies); } catch (e) { showError("Render error: " + e.message); }
}).catch(function(err) {
  if (err.message === "NEEDS_PERMISSION") {
    document.getElementById("scanBtn").addEventListener("click", function() {
      showLoading();
      requestAndGetCookies().then(function(cookies) {
        try { renderCleaner(cookies); } catch (e) { showError("Render error: " + e.message); }
      }).catch(function(e) { showError(e.message); });
    });
  } else {
    showError(err.message || "Failed to load cookies.");
  }
});
