"use strict";

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
