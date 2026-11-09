const api = globalThis.browser ?? globalThis.chrome;

const ACTUAL_ID = '__bolt-Actual-hours-input';
const ORIGINAL_ID = '__bolt-Original-estimate-input';
const REMAINING_ID = '__bolt-Remaining-work-input';
const STYLE_ID = 'simple-ado-toolkit-css';

const settings = { ...DEFAULTS };

api.storage.local.get(DEFAULTS).then((s) => {
  Object.assign(settings, s);
  applyCss();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue ?? DEFAULTS[key];
  }
  if ('customCss' in changes || 'identityId' in changes || 'identityEmail' in changes) applyCss();
});

// --- Custom CSS ($$IDENTITY_ID -> identity ID, $$IDENTITY -> email/username) ---

function applyCss() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.documentElement.appendChild(style);
  }
  const id = GUID_RE.test(settings.identityId) ? settings.identityId : '';
  // Escaped so the email is safe inside a CSS string, e.g. [title*="$$IDENTITY"].
  const email = settings.identityEmail.replace(/["\\]/g, '\\$&');
  // _ID first: $$IDENTITY is a prefix of it.
  style.textContent = settings.customCss.replaceAll('$$IDENTITY_ID', id).replaceAll('$$IDENTITY', email);
}

// --- Identity lookup, requested from the popup's Get button ---

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (window !== window.top || msg?.type !== 'getIdentity') return;
  getIdentity().then(
    (identity) => sendResponse({ identity }),
    (err) => sendResponse({ error: String(err.message ?? err) }),
  );
  return true; // keep the channel open for the async response
});

async function getIdentity() {
  const org = location.pathname.split('/')[1];
  if (!org) throw new Error('No organization in the URL');
  const res = await fetch(`${location.origin}/${org}/_apis/connectionData`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`connectionData: HTTP ${res.status}`);
  const user = (await res.json()).authenticatedUser;
  return { id: user.id, email: user.properties?.Account?.$value ?? '', name: user.providerDisplayName };
}

// --- Auto-fill Remaining Work = max(0, Original - Actual) ---

// blur doesn't bubble; focusout does. Delegated so it survives ADO's SPA re-renders.
document.addEventListener('focusout', (e) => {
  if (!settings.autoRemaining || e.target.id !== ACTUAL_ID) return;

  // Several work item forms can be open at once (e.g. dialog over a board),
  // so look for the sibling fields within the closest shared container.
  const form = closestContaining(e.target, ORIGINAL_ID);
  if (!form) return;
  const original = parseFloat(form.querySelector(`#${ORIGINAL_ID}`).value);
  const actual = parseFloat(e.target.value);
  const remainingInput = form.querySelector(`#${REMAINING_ID}`);
  if (Number.isNaN(original) || Number.isNaN(actual) || !remainingInput) return;

  const remaining = String(Math.max(0, Math.round((original - actual) * 100) / 100));
  if (remainingInput.value !== remaining) setReactValue(remainingInput, remaining);
}, true);

function closestContaining(el, id) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.querySelector(`#${id}`)) return node;
  }
  return null;
}

// ADO inputs are React-controlled: assigning .value alone gets overwritten.
// Use the native setter so React's value tracker sees a change, then fire events.
function setReactValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
