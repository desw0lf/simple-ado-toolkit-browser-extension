const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);
const toggle = $('autoRemaining');
const identity = $('identityId');
const identityEmail = $('identityEmail');
const css = $('customCss');

api.storage.local.get(DEFAULTS).then((s) => {
  toggle.checked = s.autoRemaining;
  identity.value = s.identityId;
  identityEmail.value = s.identityEmail;
  $('team').value = s.team;
  css.value = s.customCss;
});

function flash(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
  if (!isError) setTimeout(() => (el.textContent = ''), 2000);
}

// --- Auto-remaining toggle ---

toggle.addEventListener('change', () => {
  api.storage.local.set({ autoRemaining: toggle.checked });
});

// --- Identity ---

function saveIdentity(id, label = 'Saved') {
  id = id.trim();
  if (id && !GUID_RE.test(id)) return flash($('identityStatus'), 'Not a valid GUID', true);
  identity.value = id;
  api.storage.local.set({ identityId: id }).then(() => flash($('identityStatus'), label));
}

identity.addEventListener('change', () => saveIdentity(identity.value));
identityEmail.addEventListener('change', () => {
  api.storage.local.set({ identityEmail: identityEmail.value.trim() })
    .then(() => flash($('identityStatus'), 'Saved'));
});

$('getIdentity').addEventListener('click', async () => {
  const status = $('identityStatus');
  const [active] = await api.tabs.query({ active: true, currentWindow: true, url: 'https://dev.azure.com/*' });
  const tab = active ?? (await api.tabs.query({ url: 'https://dev.azure.com/*' }))[0];
  if (!tab) return flash(status, 'Open an Azure DevOps tab first', true);

  flash(status, 'Looking up…');
  try {
    const res = await api.tabs.sendMessage(tab.id, { type: 'getIdentity' });
    if (res?.error) throw new Error(res.error);
    identityEmail.value = res.identity.email;
    await api.storage.local.set({ identityEmail: res.identity.email });
    saveIdentity(res.identity.id, `Found: ${res.identity.name}`);
  } catch (err) {
    // Usually means the tab was open before the extension was (re)loaded.
    flash(status, `Failed: ${err.message} (try reloading the ADO tab)`, true);
  }
});

// --- Hours modal settings ---

$('team').addEventListener('change', (e) => {
  api.storage.local.set({ team: e.target.value.trim() }).then(() => flash($('hoursStatus'), 'Saved'));
});

// --- Custom CSS ---

function saveCss() {
  api.storage.local.set({ customCss: css.value }).then(() => flash($('cssStatus'), 'Saved'));
}

$('save').addEventListener('click', saveCss);
$('reset').addEventListener('click', () => {
  css.value = DEFAULTS.customCss;
  saveCss();
});
css.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveCss();
  }
});
