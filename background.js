// Keeps the toolbar badge in sync with the auto-remaining toggle, and shows
// the colored icon on ADO tabs (the manifest default is the gray one).
const api = globalThis.browser ?? globalThis.chrome;

const ADO_URL = 'https://dev.azure.com/';
const COLOR_ICON = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' };

function render(on) {
  api.action.setBadgeText({ text: on ? '' : 'OFF' });
  api.action.setBadgeBackgroundColor({ color: '#777' });
}

// Tab-specific icons reset on navigation, so reapply on every URL/load change.
// Without the "tabs" permission, tab.url is only visible for ADO tabs (host permission).
function colorize(tabId, url) {
  if (url?.startsWith(ADO_URL)) api.action.setIcon({ tabId, path: COLOR_ICON });
}

function sync() {
  api.storage.local.get({ autoRemaining: true }).then((s) => render(s.autoRemaining));
  api.tabs.query({ url: `${ADO_URL}*` }).then((tabs) => tabs.forEach((t) => colorize(t.id, t.url)));
}

api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status) colorize(tabId, tab.url);
});
api.runtime.onStartup.addListener(sync);
api.runtime.onInstalled.addListener(sync);
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'autoRemaining' in changes) render(changes.autoRemaining.newValue);
});
sync();
