# Changelog

Each version is served unchanged at
`https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/<version>/jbrowse-sequence-search.js`.
Older versions stay available, so sessions that use them keep working.

## 0.1.1 — 2026-10-18

- Exact queries can be up to **10,000 bases** (was 1,000). Queries with
  ambiguity codes stay limited to 100 bases.
- Long sequences are shown shortened, as the first and last bases plus the
  length, in the results list, in the result message and in results-track
  features. This keeps the data sent between JBrowse's worker and the page
  small. Coordinates are unchanged and exact.
- Wording: a one-sequence assembly now reads "the 1 sequence of …" instead of
  "all 1 sequences of …".
- Supported JBrowse: Web and Desktop 4.3.x (tested with 4.3.0), unchanged.

**Upgrading from 0.1.0.** Results tracks saved by 0.1.0 work unchanged: the
stored format is the same.

- Web: change `0.1.0` to `0.1.1` in the plugin URL in `config.json`.
- Desktop: in each session, remove the 0.1.0 entry in **Tools → Plugin store**
  (trash icon) and add the 0.1.1 URL with name `GenomeSequenceSearch`, or edit
  `umdUrl` in the session's `.jbrowse` file.

## 0.1.0 — 2026-10-14

First release: whole-assembly exact and IUPAC search, results list with
Previous/Next, results track, Stop, a 10,000-match limit, and exact queries up
to 1,000 bases.
