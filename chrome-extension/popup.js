"use strict";

var PURPOSE_ORDER = ["Advertising", "Analytics", "Marketing", "Data broker", "Error tracking", "Consent", "CDN", "Infrastructure", "Content", "Customer support"];

document.addEventListener("DOMContentLoaded", function () {
  chrome.runtime.sendMessage({ type: "getResults" }, function (data) {
    render(data);
  });

  document.getElementById("open-dashboard").addEventListener("click", function (e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("report.html") });
  });
});

function render(data) {
  var verdictEl = document.getElementById("verdict");
  var breakdownEl = document.getElementById("breakdown");
  var emptyEl = document.getElementById("empty");

  if (!data || !data.items || data.items.length === 0) {
    verdictEl.appendChild(buildVerdict(data ? data.domain : "Unknown", 0));
    emptyEl.classList.remove("hidden");
    return;
  }

  verdictEl.appendChild(buildVerdict(data.domain, data.totals.total));

  if (data.totals.total > 0) {
    breakdownEl.classList.remove("hidden");
    buildBreakdown(breakdownEl, data.items);
  } else {
    emptyEl.classList.remove("hidden");
  }
}

function buildVerdict(domain, total) {
  var level = "clean";
  var message = "No hidden tracking found.";
  if (total > 0 && total <= 5) {
    level = "warn";
    message = total + " hidden tracking element" + (total !== 1 ? "s" : "") + " found.";
  } else if (total > 5) {
    level = "bad";
    message = total + " hidden tracking elements found.";
  }

  var wrap = el("div", "verdict verdict-" + level);

  var domainEl = el("div", "verdict-domain");
  domainEl.textContent = domain;
  wrap.appendChild(domainEl);

  var countEl = el("div", "verdict-count");
  var num = el("span", "verdict-flagged");
  num.textContent = total;
  countEl.appendChild(num);
  wrap.appendChild(countEl);

  var msg = el("div", "verdict-message");
  msg.textContent = message;
  wrap.appendChild(msg);

  return wrap;
}

function buildBreakdown(container, items) {
  var purposes = {};
  for (var i = 0; i < items.length; i++) {
    var purpose = items[i].purpose || "Unknown";
    var company = items[i].company || items[i].domain;
    if (!purposes[purpose]) purposes[purpose] = {};
    purposes[purpose][company] = (purposes[purpose][company] || 0) + 1;
  }

  var sortedPurposes = [];
  for (var p = 0; p < PURPOSE_ORDER.length; p++) {
    if (purposes[PURPOSE_ORDER[p]]) {
      sortedPurposes.push(PURPOSE_ORDER[p]);
    }
  }

  var otherCompanies = {};
  var purposeKeys = Object.keys(purposes);
  for (var k = 0; k < purposeKeys.length; k++) {
    if (PURPOSE_ORDER.indexOf(purposeKeys[k]) === -1) {
      var companies = purposes[purposeKeys[k]];
      var companyNames = Object.keys(companies);
      for (var c = 0; c < companyNames.length; c++) {
        otherCompanies[companyNames[c]] = (otherCompanies[companyNames[c]] || 0) + companies[companyNames[c]];
      }
    }
  }
  var hasOther = Object.keys(otherCompanies).length > 0;

  var label = el("div", "section-label");
  label.textContent = "Who's tracking";
  container.appendChild(label);

  var bd = el("div", "breakdown-list");

  for (var s = 0; s < sortedPurposes.length; s++) {
    var purpose = sortedPurposes[s];
    var companyCounts = purposes[purpose];
    var total = 0;
    var companyList = Object.keys(companyCounts).sort(function (a, b) {
      return companyCounts[b] - companyCounts[a];
    });
    for (var j = 0; j < companyList.length; j++) {
      total += companyCounts[companyList[j]];
    }

    var row = el("div", "breakdown-row");
    var catEl = el("span", "breakdown-category");
    catEl.textContent = purpose;
    var countEl = el("span", "breakdown-count");
    countEl.textContent = total;
    row.appendChild(catEl);
    row.appendChild(countEl);
    bd.appendChild(row);

    var list = el("div", "domain-list");
    for (var d = 0; d < companyList.length; d++) {
      var companyRow = el("div", "domain-row");
      var nameEl = el("span", "domain-name");
      nameEl.textContent = companyList[d];
      var cntEl = el("span", "domain-count");
      cntEl.textContent = companyCounts[companyList[d]];
      companyRow.appendChild(nameEl);
      companyRow.appendChild(cntEl);
      list.appendChild(companyRow);
    }
    bd.appendChild(list);
  }

  if (hasOther) {
    var otherTotal = 0;
    var otherList = Object.keys(otherCompanies).sort(function (a, b) {
      return otherCompanies[b] - otherCompanies[a];
    });
    for (var o = 0; o < otherList.length; o++) {
      otherTotal += otherCompanies[otherList[o]];
    }

    var otherRow = el("div", "breakdown-row breakdown-other");
    var otherCat = el("span", "breakdown-category");
    otherCat.textContent = "Other";
    var otherCount = el("span", "breakdown-count");
    otherCount.textContent = otherTotal;
    otherRow.appendChild(otherCat);
    otherRow.appendChild(otherCount);
    bd.appendChild(otherRow);
  }

  container.appendChild(bd);
}

function el(tag, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
