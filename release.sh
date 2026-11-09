#!/usr/bin/env bash
# Usage: ./release.sh 0.2.0
# Sets the manifest version, commits, tags v0.2.0 and pushes; the Release workflow does the rest.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Usage: $0 x.y.z" >&2; exit 1; }
[[ "$(git branch --show-current)" == master ]] || { echo "Not on master" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree not clean" >&2; exit 1; }

# The workflow commits updates.json to master after each release.
git pull --ff-only --tags -q
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "Tag v$VERSION already exists" >&2; exit 1; }

perl -pi -e 's/"version": "[^"]*"/"version": "'"$VERSION"'"/' manifest.json
if [[ -n "$(git status --porcelain manifest.json)" ]]; then
  git commit -q -m "Release v$VERSION" manifest.json
fi
git tag "v$VERSION"
git push -q origin master "v$VERSION"
echo "Pushed v$VERSION: https://github.com/desw0lf/simple-ado-toolkit-browser-extension/actions"
