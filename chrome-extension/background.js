"use strict";

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
