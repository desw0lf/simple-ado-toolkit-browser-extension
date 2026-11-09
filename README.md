# Simple ADO Toolkit

Browser extension (Chrome + Firefox/Zen, Manifest V3) for `https://dev.azure.com/*`.

## Features

- **Auto-fill Remaining Work** – when the *Actual hours* field loses focus, Remaining Work is set to
  `max(0, Original estimate − Actual hours)`. Toggle it in the popup (badge shows `OFF` when disabled).
- **Identity** – click *Get* in the popup (with an ADO tab open) to look up your email/username and
  identity ID via `_apis/connectionData`, or enter them manually.
- **Custom CSS** – paste CSS in the popup and save (`Cmd/Ctrl+S` works too); applied live to all ADO tabs.
  `$$IDENTITY` is replaced with your email/username, `$$IDENTITY_ID` with your identity ID.
  *Reset to default* restores the built-in CSS.
- The toolbar icon is colored on ADO tabs and gray elsewhere.
- **Hours modal** – the floating clock button (bottom-right) shows the Actual hours you saved per day for
  the current sprint; ‹ › (or ←/→) move between sprints. Totals are computed from work item history
  (only your own changes to the *Actual hours* field, by the day they were saved) and shown as one table
  per week (weekends only when hours were logged). The daily target is your sprint capacity per day (none
  when capacity isn't set); your and the team's days off show as **H** and don't count towards the target. Click a day to list its work items. The team comes from the popup,
  else the URL, else the project's default team; without sprints it falls back to 2-week windows.

## Install

**Zen / Firefox:** open the `.xpi` from the
[latest release](https://github.com/desw0lf/simple-ado-toolkit-browser-extension/releases/latest) in
Zen/Firefox and confirm. Updates install automatically (Firefox checks `updates.json` about once a day;
to check now: `about:addons` → ⚙ → *Check for Updates*). If the extension doesn't run, open the
extensions menu and grant it access to `dev.azure.com`.

**Chrome:** `chrome://extensions` → enable Developer mode → *Load unpacked* → select your clone of this
repo. To update: `git pull`, then click ↻ on the extension.

**Development (Zen / Firefox):** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
select `manifest.json` (removed on restart).

## Release

```sh
./release.sh 0.2.0
```

Sets the manifest version, commits, tags `v0.2.0` and pushes. The *Release* workflow then signs the
add-on as unlisted on AMO (a few minutes), publishes a GitHub Release with the `.xpi`, and adds it to
`updates.json` on `master`. Each release needs a new version: AMO never re-signs a version.

One-time setup:
1. Create an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/) (accept the developer
   agreement if asked).
2. Repo *Settings* → *Secrets and variables* → *Actions*: add `AMO_JWT_ISSUER` (JWT issuer) and
   `AMO_JWT_SECRET` (JWT secret).

`web-ext-config.mjs` sets the unlisted channel and keeps non-extension files out of the package. The
workflow has a commented-out Chrome Web Store job for later.

## Icons

Edit `icons/icon.svg`, then regenerate the PNGs (macOS): `swift scripts/render-icons.swift`

## Lint

```sh
npx web-ext lint --self-hosted
```

(`--self-hosted` because the manifest has an `update_url`, which only unlisted add-ons may use.)
