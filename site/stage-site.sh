#!/bin/sh
# Stages the single GitHub Pages site that serves every plugin.
# Usage: sh site/stage-site.sh <trello-check-date build dir> <output dir>
#
# Layout (the Pages site is served at /web-plugins/):
#   <out>/trello-check-date/...                   Trello Power-Up build
#   <out>/jbrowse-sequence-search/<version>/...    every committed JBrowse release
# A Pages deployment replaces the whole site, so anything not staged here
# disappears. The script fails rather than publish an incomplete site.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
trello_dist=${1:?trello build directory}
out=${2:?output directory}

test -f "$trello_dist/apps/overdue-checklist/connector.html" || {
  echo "Trello build is missing apps/overdue-checklist/connector.html: $trello_dist" >&2; exit 1; }

rm -rf "$out"
mkdir -p "$out/trello-check-date" "$out/jbrowse-sequence-search"
cp -R "$trello_dist/." "$out/trello-check-date/"

releases="$root/jbrowse-sequence-search/releases"
count=0
for dir in "$releases"/*/; do
  [ -d "$dir" ] || continue
  version=$(basename "$dir")
  dest="$out/jbrowse-sequence-search/$version"
  mkdir -p "$dest"
  cp "$dir"/jbrowse-sequence-search.js "$dir"/jbrowse-sequence-search.js.map \
     "$dir"/BUILD-INFO.json "$dir"/SHA256SUMS "$dest/"
  (cd "$dest" && sha256sum -c --quiet SHA256SUMS) || {
    echo "Checksum mismatch in JBrowse release $version" >&2; exit 1; }
  count=$((count + 1))
done
[ "$count" -gt 0 ] || { echo "No JBrowse releases found in $releases" >&2; exit 1; }

echo "Staged $out:"
(cd "$out" && find . -type f | sort)
