// Firefox cookies API adapter
async function getAllCookies() {
  return browser.cookies.getAll({});
}
