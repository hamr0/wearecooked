"use strict";

// scoper-bridge.js — the data layer for wearehere's popup card and
// dashboard. All read/write calls in popup-card.js + dashboard-blocks.js
// route through self.scoperDataLayer; this file is the only place that
// knows how to reach wearecooked.

// REPLACE BEFORE SHIP — see INTEGRATION-GUIDE.md step 3.
const WEARECOOKED_EXT_ID = "REPLACE_WITH_WEARECOOKED_EXTENSION_ID";

function sendToWearecooked(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(WEARECOOKED_EXT_ID, msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || {});
        }
      });
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
}

self.scoperDataLayer = {
  // ---- reads ------------------------------------------------------------
  async getState() {
    return await sendToWearecooked({ type: "scoper:get-state" });
  },
  async cookieCountForDomain(domain) {
    // wearehere can call chrome.cookies directly if it has the "cookies"
    // permission (faster, no round-trip). Falls back to the proxy
    // otherwise.
    if (chrome.cookies && chrome.cookies.getAll) {
      return await new Promise((r) =>
        chrome.cookies.getAll({ domain }, (cs) => r((cs || []).length))
      );
    }
    const resp = await sendToWearecooked({ type: "scoper:cookie-count", domain });
    return (resp && resp.count) || 0;
  },
  async getActiveTab() {
    return await new Promise((r) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t && t[0]))
    );
  },

  // ---- writes -----------------------------------------------------------
  async setTrust(etld1, cap) {
    return await sendToWearecooked({ type: "scoper:set-trust", etld1, cap });
  },
  async setSettings(settings) {
    return await sendToWearecooked({ type: "scoper:set-settings", settings });
  },
  async sweepNow() {
    return await sendToWearecooked({ type: "scoper:sweep-now" });
  },

  // ---- misc -------------------------------------------------------------
  // popup-card.js's "Open dashboard" link goes to wearecooked's standalone
  // dashboard URL by default. If wearehere's panel-cookies is the new
  // canonical dashboard, override openDashboard to switch tabs instead.
  openDashboard() {
    chrome.tabs.create({ url: "chrome-extension://" + WEARECOOKED_EXT_ID + "/dashboard.html" });
  },
};
