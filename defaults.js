// Shared by content.js and popup.js.
const DEFAULTS = {
  autoRemaining: true,
  identityId: '',
  identityEmail: '',
  team: '', // empty = team from URL, else the project's default team
  customCss: `.work-details-pane > div:not(:last-child) { display: none; }
.work-details-pane > div > div { display: none;}
.work-details-pane [data-identityid="$$IDENTITY_ID"] { background: rgb(255 255 255 / 5%); }
`,
};

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
