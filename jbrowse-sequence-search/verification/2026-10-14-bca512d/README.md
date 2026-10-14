# Verification run — 2026-10-14, source commit bca512d

| Item | Value |
| --- | --- |
| Source commit | `bca512df1f49243d29632cfec5fc04d05445158c`, working tree clean (`sourceDirty: no` in `build/BUILD-INFO.json` and both reports) |
| Plugin | jbrowse-sequence-search 0.1.0, `GenomeSequenceSearch` |
| Build | Docker image from `jbrowse-sequence-search/Dockerfile` (node 22.23.2, esbuild 0.28.2). A second build of this commit gave a byte-identical archive. |
| Archive | `build/jbrowse-sequence-search-0.1.0.tar.gz`, sha256 `d86b33bec7897757d7d64a19cc0d17a293a195c3751db61b63bbaa28fc718b1c` |
| Plugin file | `jbrowse-sequence-search.js`, sha256 `f6a43b81c5627a20e51bb52b73b6b711d2bba8402c444cf23a5eeedb78817254` |
| Unit tests | 39 passed, 0 failed (`npm test` in the Docker image); lint clean |
| JBrowse Web | official `jbrowse-web-v4.3.0.zip` (sha256 `a9d42417102ee088a1cbf85c6d857c1065d66984ea6c56f3115ef9dd56d76702`), `version.txt` 4.3.0 |
| JBrowse Desktop | official `jbrowse-desktop-v4.3.0-linux.AppImage` (sha256 `f1dfe71767bdd812d8ce5c3b31f2e89fe756667c27a081422f2fa04c6035135e`), extracted and run under Xvfb; reports `JBrowse2/4.3.0`, Electron 41.2.0 |
| Browser (Web) | Chromium 141.0.7390.37 (headless), driven by Playwright 1.56.1 on Node 22.22.0 |
| Data | Synthetic genomes from `tests/browser/fixture.mjs`, served by its local Range-capable HTTP server on 127.0.0.1 |

## Results

- `web/report.json`: 18 of 18 checks passed (`tests/browser/web.mjs`), with
  screenshots `web/01-…png` to `web/08-…png`. `web/config.json` is the
  JBrowse configuration used: a root-relative plugin URL on the same server.
- `desktop/report.json`: 7 of 7 checks passed (`tests/browser/desktop.mjs`),
  with screenshots `desktop/01-…png` to `desktop/08-…png`.
  `desktop/saved-session-after-search.jbrowse` is the session file as Desktop
  saved it after the plugin was installed through *Add custom plugin* and a
  search was run. It contains
  `"plugins": [{"name": "GenomeSequenceSearch", "umdUrl": "http://127.0.0.1:…"}]`
  and the results track.
- `build/`: `BUILD-INFO.json`, `SHA256SUMS` and the release archive that was
  tested.

## Observations from development runs (earlier commits, same plugin code paths)

- **Desktop, unreachable plugin URL:** a session whose plugin URL could not
  be reached failed to open, showing
  `Error: Failed to load script: http://127.0.0.1:9/…` on the start screen.
  This was a one-off probe with a scratch script.
- **Desktop, forced shutdown:** stopping Desktop with SIGTERM while it was
  saving left an empty session file. The Desktop check now closes the window
  instead; with that change no file was truncated.
- **Scale:** a 250 Mb synthetic assembly (10 × 25 Mb) in JBrowse Web 4.3.0
  was searched for `GAATTCAAGG` (486 matches) in 12.9 s and for an absent
  20-mer in 6.6 s. The main thread had at most one long task (59 ms), and the
  largest animation-frame gap was 72 ms. This was a one-off scratch run, and
  the script is not in the repository.
- **Example:** `example/config.json` was loaded in JBrowse Web 4.3.0 with the
  documented layout and found the three expected matches.

## Not verified

- Your production server, JBrowse Desktop on macOS or Windows, and browsers
  other than Chromium.
- Desktop: whether new sessions need the plugin added again. Source analysis
  says they do; this was not tested at runtime.
- Real genomes, such as human, at full size.
