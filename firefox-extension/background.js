"use strict";

var tabData = {};

browser.runtime.onMessage.addListener(function (message, sender) {
  if (message.type === "scanResult" && sender.tab) {
    var tabId = sender.tab.id;
    tabData[tabId] = message;
    updateBadge(tabId, message.totals.total);
    return;
  }

  if (message.type === "getResults") {
    return browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      if (tabs.length === 0) return null;
      var tabId = tabs[0].id;
      return tabData[tabId] || null;
    });
  }
});

function updateBadge(tabId, count) {
  var text = count > 0 ? String(count) : "0";
  browser.browserAction.setBadgeText({ text: text, tabId: tabId });
  browser.browserAction.setBadgeBackgroundColor({
    color: count > 0 ? "#e74c3c" : "#555555",
    tabId: tabId,
  });
}

browser.tabs.onRemoved.addListener(function (tabId) {
  delete tabData[tabId];
});

browser.tabs.onActivated.addListener(function (activeInfo) {
  var data = tabData[activeInfo.tabId];
  if (data) {
    updateBadge(activeInfo.tabId, data.totals.total);
  }
});
