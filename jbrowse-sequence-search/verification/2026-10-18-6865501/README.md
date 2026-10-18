# Verification run — 2026-10-18, source commit 6865501 (release 0.1.1)

| Item | Value |
| --- | --- |
| Source commit | `68655012dab8b482f27ccfccac8f03cb8e0b7aeb`, working tree clean (`sourceDirty: no` in `build/BUILD-INFO.json` and both reports) |
| Plugin | jbrowse-sequence-search 0.1.1, `GenomeSequenceSearch` |
| Build | Docker image from `jbrowse-sequence-search/Dockerfile` (node 22.23.2, esbuild 0.28.2). A second build of this commit gave a byte-identical archive. |
| Archive | `build/jbrowse-sequence-search-0.1.1.tar.gz`, sha256 `4d16c35a22dbe87b9b13643c2202f685ff158427017f6cc59dac0d071f83179f` |
| Plugin file | `jbrowse-sequence-search.js`, sha256 `86bf0bd49f9f7debe0c7579d43d400dd3d871af2894731e2be9a061c02e639c7` |
| Unit tests | 44 passed, 0 failed (`npm test` in the Docker image); lint clean |
| JBrowse Web | official `jbrowse-web-v4.3.0.zip` (sha256 `a9d42417102ee088a1cbf85c6d857c1065d66984ea6c56f3115ef9dd56d76702`) |
| JBrowse Desktop | official `jbrowse-desktop-v4.3.0-linux.AppImage` (sha256 `f1dfe71767bdd812d8ce5c3b31f2e89fe756667c27a081422f2fa04c6035135e`), run under Xvfb |
| Browser (Web) | Chromium 141.0.7390.37 (headless), Playwright 1.56.1, Node 22.22.0 |

## Results

- `web/report.json`: 19 of 19 checks passed. That includes the new 10,000-base
  check: a query spanning ctgA's 1 Mb chunk boundary is found exactly once at
  ctgA:995,001-1,005,000, a 10,001-base query is rejected, and the track
  feature from the worker is 343 bytes with a shortened matched sequence.
  It also includes the single-sequence wording ("the 1 sequence of
  othergenome"). Screenshots `web/01-…png` to `web/09-…png`
  (`06-long-query.png` shows the 10 kb result).
- `desktop/report.json`: 7 of 7 checks passed: install through *Add custom
  plugin*, search, navigation, saved results, reopen, and `file://` rejected.
  `desktop/saved-session-after-search.jbrowse` is the session file Desktop
  saved.
- `build/`: `BUILD-INFO.json`, `SHA256SUMS` and the release archive that was
  tested.

## Compatibility with 0.1.0 results

The results session saved by 0.1.0
(`../2026-10-14-bca512d/desktop/saved-session-after-search.jbrowse`) decodes
unchanged with 0.1.1's code: the same 6 hits, with features built by the
new `featureData`. This was a one-off check with Node, not part of the
reports.

## Not verified

- Your production use, JBrowse Desktop on macOS or Windows, and browsers
  other than Chromium.
- Real genomes, such as human, at full size.
