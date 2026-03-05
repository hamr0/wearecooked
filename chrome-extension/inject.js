"use strict";

// Runs in page context — wraps navigator.sendBeacon to intercept calls
(function () {
  var origBeacon = navigator.sendBeacon;
  if (!origBeacon) return;

  navigator.sendBeacon = function (url, data) {
    try {
      window.postMessage({
        type: "__wearecounted_beacon__",
        url: String(url),
      }, "*");
    } catch (e) {}
    return origBeacon.apply(navigator, arguments);
  };
})();
