"use strict";

// wearecooked v5 cookie scoper (Phase 1). Loaded into the v4 service
// worker via importScripts — order matters: data files (psl,
// cookie-database) -> policy -> sweep. v4 scanner code below is
// unchanged.
importScripts("psl.js", "cookie-database.js", "scoper.js", "scoper-sweep.js");

function tabKey(tabId) {
  return "tab:" + tabId;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "scanResult" && sender.tab) {
    var tabId = sender.tab.id;
    var obj = {};
    obj[tabKey(tabId)] = message;
    chrome.storage.session.set(obj);
    updateBadge(tabId, message.totals.total);
  }

  if (message.type === "getResults") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length === 0) {
        sendResponse(null);
        return;
      }
      var tabId = tabs[0].id;
      chrome.storage.session.get(tabKey(tabId), function (result) {
        sendResponse(result[tabKey(tabId)] || null);
      });
    });
    return true;
  }

  // Popup "Sweep now" — bypasses the dedup gate via the 'manual' trigger.
  if (message.type === "sweep:now") {
    self.initialSweep("manual").then(function (stats) { sendResponse(stats || {}); });
    return true;
  }

  // Dashboard wrote new alarmPeriodMin to storage.local.scoperSettings —
  // re-create the alarm to apply the new cadence.
  if (message.type === "settings:reload") {
    self.ensureAlarm().then(function () { sendResponse({ ok: true }); });
    return true;
  }
});

// ---------------------------------------------------------------------------
// Cross-extension API (used by wearehere)
//
// Dormant until manifest.externally_connectable.ids includes wearehere's
// extension ID. See INTEGRATION-GUIDE.md (port-kit/) for the handshake.
// ---------------------------------------------------------------------------

const SCOPER_STATE_KEYS = ["scoperStats", "scoperTrust", "scoperSettings", "scoperHistory", "seenSites"];

chrome.runtime.onMessageExternal.addListener(function (msg, sender, sendResponse) {
  // Defense in depth: manifest restricts who can reach us, but verify
  // sender.id anyway so an accidentally-broad ids list can't trash trust.
  if (!self.WEARECOOKED_ALLOWED_EXT_IDS || !self.WEARECOOKED_ALLOWED_EXT_IDS.includes(sender.id)) {
    sendResponse({ error: "unauthorized", from: sender.id });
    return;
  }

  if (msg.type === "scoper:get-state") {
    chrome.storage.local.get(SCOPER_STATE_KEYS, function (s) { sendResponse(s || {}); });
    return true;
  }

  if (msg.type === "scoper:set-trust") {
    if (typeof msg.etld1 !== "string") { sendResponse({ error: "etld1 required" }); return; }
    chrome.storage.local.get("scoperTrust", function (o) {
      var t = o.scoperTrust || {};
      if (msg.cap === 0) {
        delete t[msg.etld1];
      } else if (msg.cap === 30 || msg.cap === 90) {
        t[msg.etld1] = { capDays: msg.cap, addedAt: Date.now() };
      } else {
        sendResponse({ error: "cap must be 0, 30, or 90" });
        return;
      }
      chrome.storage.local.set({ scoperTrust: t }, function () { sendResponse({ ok: true, trust: t }); });
    });
    return true;
  }

  if (msg.type === "scoper:set-settings") {
    if (!msg.settings || typeof msg.settings.alarmPeriodMin !== "number") {
      sendResponse({ error: "settings.alarmPeriodMin required" });
      return;
    }
    chrome.storage.local.set({ scoperSettings: msg.settings }, function () {
      self.ensureAlarm().then(function () { sendResponse({ ok: true }); });
    });
    return true;
  }

  if (msg.type === "scoper:sweep-now") {
    self.initialSweep("manual").then(function (stats) { sendResponse(stats || {}); });
    return true;
  }

  if (msg.type === "scoper:cookie-count") {
    if (typeof msg.domain !== "string") { sendResponse({ error: "domain required" }); return; }
    chrome.cookies.getAll({ domain: msg.domain }, function (cs) { sendResponse({ count: (cs || []).length }); });
    return true;
  }

  sendResponse({ error: "unknown message type", type: msg.type });
});

function updateBadge(tabId, count) {
  var text = count > 0 ? String(count) : "0";
  chrome.action.setBadgeText({ text: text, tabId: tabId });
  chrome.action.setBadgeBackgroundColor({
    color: count > 0 ? "#e74c3c" : "#555555",
    tabId: tabId,
  });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
  chrome.storage.session.remove(tabKey(tabId));
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.storage.session.get(tabKey(activeInfo.tabId), function (result) {
    var data = result[tabKey(activeInfo.tabId)];
    if (data) {
      updateBadge(activeInfo.tabId, data.totals.total);
    }
  });
});
