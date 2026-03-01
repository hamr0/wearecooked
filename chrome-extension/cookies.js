// Chrome cookies API adapter with runtime permission request
async function getAllCookies() {
  // Check if already granted — skip the prompt
  const already = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  if (!already) {
    throw new Error("NEEDS_PERMISSION");
  }
  return chrome.cookies.getAll({});
}

async function requestAndGetCookies() {
  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  if (!granted) {
    throw new Error("Host permission required to read cookies from all sites.");
  }
  return chrome.cookies.getAll({});
}
