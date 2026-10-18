# JBrowse genome sequence search

A JBrowse 2 plugin that searches **every sequence of one assembly** for a DNA
sequence and shows the matches as a clickable list and as a normal feature
track. Click a match to go to it; use **Previous**/**Next** to step through
matches in genome order.

**Version 0.1.1** · plugin name `GenomeSequenceSearch` · supports **JBrowse Web
and JBrowse Desktop 4.3.x** (tested with 4.3.0; see [Compatibility](#compatibility)).

- No search server, JBrowse fork or custom JBrowse build is needed. The plugin
  is a single versioned JavaScript file. It is served by this repository's
  GitHub Pages site together with the other plugins, at
  `https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`
  once deployed from `main`, and can equally be hosted on your own server.
- Searching runs in JBrowse's background worker, so the browser stays
  responsive. The search reads each sequence in 1 Mb pieces.
- [DEPLOYMENT.md](DEPLOYMENT.md) covers server layout, Web configuration,
  Desktop installation, offline use and upgrades.
- [docs/DESIGN.md](docs/DESIGN.md) records design decisions and the JBrowse
  4.3.0 source findings they rest on.
- [CHANGELOG.md](CHANGELOG.md) lists what changed in each version and how to
  upgrade.
- [docs/MANUAL-DESKTOP-CHECK.md](docs/MANUAL-DESKTOP-CHECK.md) is a short
  manual check for your own Desktop installation and server.
- [verification/](verification/) holds the saved evidence from the browser
  runs.

## Using it

1. Choose **Tools → Search genome…**, or **Search genome…** in a linear genome
   view's menu (☰). The menu item sits just below the built-in
   *Sequence search*. The panel opens on the right.
2. **Assembly** defaults to the view you opened it from. The panel states the
   scope, for example *“Searches all 25 sequences of hg38 (3.10 Gb), both
   strands — the whole assembly, not just the region on screen.”*
3. Paste a **DNA sequence** and press **Search**. A progress bar shows how much
   of the assembly has been searched and how many matches so far. **Stop**
   cancels; pressing **Restart search** with a new sequence replaces the
   running search.
4. The result message says exactly what was searched and whether the list is
   complete (see [Outcomes](#outcomes)).
5. The list shows match number, sequence (contig), start, end, strand and the
   matched bases. Coordinates are **1-based and inclusive**, as in the JBrowse
   location box. Click a row to show the match with flanking sequence (at
   least 50 bp, or the match length, on each side). **Previous** and **Next**
   move through the list in genome order and stop at the first and last match.
6. A results track named like *“Search: GAATTC in hg38”* is added to the view.
   It is a normal feature track: features are labelled *Match 12* and so on,
   and clicking one shows its details. The list and the track read the same
   stored result set (see [Results and sessions](#results-and-sessions)), so
   they cannot disagree.

The panel is an ordinary JBrowse side panel. It stays open, with its results,
while you navigate. You can reopen it from either menu.

## Search rules

| Topic | Behaviour |
| --- | --- |
| Scope | Every sequence (contig/chromosome) of the selected assembly, regardless of what is on screen. One assembly per search, never all loaded assemblies. |
| Strands | Both strands by default; forward-only and reverse-only are options. |
| Case | Case-insensitive. Soft-masked (lowercase) genome sequence matches like any other. |
| Overlaps | All overlapping occurrences are reported, e.g. `AAA` in `AAAAAA` gives 4 matches per strand. |
| Reverse strand | A reverse-strand match is reported at its forward-strand interval with strand **−**, and its matched sequence is shown 5′→3′ on the − strand (equal to the query). |
| Palindromes | A location that matches on both strands (e.g. `GAATTC`, its own reverse complement) is listed **once**, with strand **both**, and the panel says so. With a single strand selected it is listed on that strand. |
| Contig boundaries | A match never spans two sequences. |
| Chunk boundaries | Sequences are read in 1 Mb chunks that overlap by query length − 1. Each match belongs to the chunk containing its start, so none is lost or duplicated (tested exhaustively against brute force with chunk sizes from 1 bp). |
| Pasted text | Spaces, line breaks and digits (GenBank/EMBL numbering) are ignored, as is one FASTA header line (`>…`) at the top. The panel says what was ignored. More than one FASTA record is rejected. |
| Invalid input | `U`, gap characters (`-`), regular-expression syntax (`. * [ ] ( ) |` …) and other non-nucleotide letters are rejected with an explanation; nothing is silently dropped. |
| Length | 1–10,000 bases for exact searches; 1–100 with ambiguity codes. Long sequences are shown shortened in the list and in track features (first and last bases plus the length); coordinates are always exact. |
| Ambiguity codes | Off by default; a query containing `N`, `R`, `Y`, … is rejected until **Allow ambiguity codes** is ticked. Then each IUPAC code matches its set of bases (`N` = A/C/G/T, `R` = A/G, `Y` = C/T, `S`, `W`, `K`, `M`, `B`, `D`, `H`, `V`). This is not regular-expression syntax. A query code never matches an `N` (or any non-ACGT letter) in the genome, so assembly gaps are never matches. The list shows the actual genome bases for each match. |
| Result limit | The search stops after **10,000** matches, see below. |
| Regular expressions | Not supported in this release (see [docs/DESIGN.md](docs/DESIGN.md#regular-expressions)). |
| Circular sequences | Not supported. JBrowse 4.3 assemblies carry no topology information, so every sequence is treated as linear, and a match that wraps around the origin of a circular chromosome (e.g. mitochondrion, plasmid) is **not found**. |
| Mismatches/indels | Exact matching only (apart from ambiguity codes). |

### Outcomes

| Message | Meaning |
| --- | --- |
| *Found N matches. Searched all K sequences of …* (green) | Complete: every sequence and the chosen strands were searched, and every match is listed. |
| *No matches. Searched all K sequences of …* (blue) | Complete, with zero matches. No track is created. |
| *Incomplete: stopped at the limit of 10,000 matches …* (amber) | More than 10,000 matches exist. The first 10,000 in genome order are listed, through the named position; the rest of the assembly was not searched. Use a longer sequence. |
| *Incomplete: search stopped …* (amber) | You pressed Stop. Matches starting up to the named position are listed; nothing after it was searched. |
| *Incomplete: the search failed (…)* (red) | A sequence could not be read, for example a network or file error. Matches before the named position are listed. |

Incomplete results tracks get *(incomplete)* in their names.

## Results and sessions

- Results live in one place: the results track's configuration, in a compact
  text encoding of about 11–14 bytes per match plus a small header; 10,000
  human-genome matches measured 108 KB (ambiguity searches add a few bytes per
  match). The list decodes the same value,
  and the track's adapter decodes it in the worker.
- **Web:** results tracks are session tracks. They are saved with the session
  (JBrowse autosaves to the browser's session storage and IndexedDB), are
  restored on reload (tested), and are included when you share or export the
  session. Because JBrowse re-serializes the whole session after every change,
  remove results tracks you no longer need, especially large ones.
- **Desktop:** results tracks are saved in the session's `.jbrowse` file
  (tested: quit, reopen, results still listed).
- Each new search adds a new track and hides the panel's previous one from the
  view. Earlier tracks stay in the track selector under *Genome search
  results* until you remove them. The panel always shows the latest search;
  if its track is removed, the panel says so.
- A session containing results tracks needs this plugin to display them.
  Without the plugin, JBrowse reports an unknown adapter type
  `GenomeSequenceSearchResultsAdapter` for those tracks only.
- The panel's form (assembly, sequence, options) is saved with the session.
  A search that is running when the session is saved is not resumed.

## Compatibility

| JBrowse | Status |
| --- | --- |
| Web 4.3.0 | **Supported, runtime-tested** (release `jbrowse-web-v4.3.0.zip`, Chromium) |
| Desktop 4.3.0 | **Supported, runtime-tested** (Linux AppImage under Xvfb, installed via *Add custom plugin*) |
| 4.3.x patch releases | Expected to work; re-run the browser checks before rolling out |
| Earlier 4.x, 3.x | Not supported or tested |
| 5.0 (beta) | Not supported or tested; plugin packaging is changing upstream |

The plugin relies on these JBrowse 4.3 facilities:

- the `CoreGetSequence` RPC method and `RpcMethodType`;
- `rootModel.appendToMenu`;
- the `Core-extendPluggableElement` extension point, to extend the
  `LinearGenomeView` menu;
- session widgets and `addTrackConf`;
- the Linear Genome View's `navToLocations`, `showTrack`, `hideTrack` and
  `init`;
- the modules JBrowse 4.3.0 shares with plugins (`JBrowseExports`). The build
  fails if the code imports anything outside that list.

Before upgrading JBrowse, follow the upgrade checklist in
[DEPLOYMENT.md](DEPLOYMENT.md#upgrading).

## Known limitations

- Exact or IUPAC matching only. There are no regular expressions, mismatches
  or gaps, and the query is at most 10,000 bases (100 with ambiguity codes).
  A single difference anywhere in a long query means no match.
- At most 10,000 matches per search, clearly labelled when reached.
- Circular-origin-spanning matches are not found (see above).
- One assembly per search.
- Speed depends on how fast the server delivers sequence. In testing, a
  250 Mb assembly took 7–13 s (local server, Chromium). Expect minutes for a
  human-sized genome.
- With JBrowse's default web-worker RPC, scanning runs off the UI thread. If
  a deployment sets `MainThreadRpcDriver`, scanning runs on the main thread
  in 1 Mb steps.
- The sequence adapter stays cached in the worker between searches, under one
  RPC session id. Reloading the page clears it.
- **Desktop:** if the plugin URL saved in a session cannot be reached when the
  session opens, JBrowse Desktop 4.3.0 refuses to open the whole session
  (*Failed to load script*). See [offline use](DEPLOYMENT.md#offline-desktop-use).

## Development

Run all commands from `jbrowse-sequence-search/`. Docker supplies Node; no
host npm installation is needed.

```bash
docker build -t jbrowse-sequence-search:dev .
mkdir -p dist
docker run --rm --user "$(id -u):$(id -g)" \
  -e SOURCE_COMMIT="$(git rev-parse HEAD)" \
  -e SOURCE_DIRTY="$(test -z "$(git status --porcelain)" && echo no || echo yes)" \
  --mount type=bind,src="$PWD/dist",dst=/app/dist \
  jbrowse-sequence-search:dev        # lint, unit tests, production build
```

Behind a TLS-intercepting proxy, add
`--secret id=extra_ca,src=/path/to/ca.pem` to `docker build`.

The default command runs lint, tests, the build and `npm run check:releases`.
Run a single step with `jbrowse-sequence-search:dev npm run lint`,
`npm test`, `npm run build` or `npm run check:releases`. The build writes the versioned layout described
in [DEPLOYMENT.md](DEPLOYMENT.md#artifacts), including `BUILD-INFO.json` with
the source commit and dirty state you pass in. Builds are deterministic: the
same commit gives byte-identical files.

| Path | Contents |
| --- | --- |
| `src/search/` | Pure search logic: query validation, IUPAC, scanning, chunking, the bounded runner, result encoding. No JBrowse imports. |
| `src/jbrowse/` | JBrowse glue: the worker RPC method, the results adapter, session/view helpers |
| `src/widget/` | The side panel: state model and React components |
| `src/index.jsx` | Plugin registration and menu entries |
| `tests/*.test.js` | Unit tests (`node --test`), including brute-force comparisons |
| `tests/browser/` | End-to-end checks against real JBrowse Web and Desktop releases |
| `releases/` | Released builds served by GitHub Pages; immutable ([releases/README.md](releases/README.md)) |
| `tools/` | Build script, release check, and JBrowse 4.3.0's shared-module list |
| `example/` | Minimal runnable example ([example/README.md](example/README.md)) |
| `verification/` | Saved evidence from browser runs |

### Browser checks

These use an existing Playwright installation and the official JBrowse
release files, which are not committed. Download and unpack them first:

```bash
curl -LO https://github.com/GMOD/jbrowse-components/releases/download/v4.3.0/jbrowse-web-v4.3.0.zip
unzip -q jbrowse-web-v4.3.0.zip -d /tmp/jbrowse-web-4.3.0
curl -LO https://github.com/GMOD/jbrowse-components/releases/download/v4.3.0/jbrowse-desktop-v4.3.0-linux.AppImage
chmod +x jbrowse-desktop-v4.3.0-linux.AppImage && ./jbrowse-desktop-v4.3.0-linux.AppImage --appimage-extract

PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
BROWSER_EXECUTABLE=/path/to/chrome JBROWSE_WEB_DIR=/tmp/jbrowse-web-4.3.0 \
TEST_OUTPUT_DIR=/tmp/genome-search-web node tests/browser/web.mjs

PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
JBROWSE_DESKTOP_BIN="$PWD/squashfs-root/jbrowse-desktop.bin" \
TEST_OUTPUT_DIR=/tmp/genome-search-desktop node tests/browser/desktop.mjs
```

Both scripts write `report.json` and screenshots to `TEST_OUTPUT_DIR`. The
Desktop script needs `xvfb-run` on a headless machine (set `XVFB_RUN=""` when
a display is available) and runs Desktop with a throwaway `HOME`.

The Web script checks the following:

- loading from a self-hosted URL, on the page and in the worker;
- the Tools menu and the view menu;
- input validation;
- the planted hits: beyond the visible region, on other contigs, at contig
  ends, across the 1 Mb chunk boundary, soft-masked, never across contigs;
- that the track and the list agree, with the worker reading the track;
- click navigation and Previous/Next;
- palindromic and IUPAC searches against brute force;
- no matches, the 10,000-match limit with list virtualization, Stop,
  replacement searches and assembly selection;
- results after a page reload, and no page errors.

The Desktop script covers the following:

- installation through **Add custom plugin**;
- search, navigation and Previous/Next;
- saved results matching the list;
- results after quitting and reopening;
- rejection of a `file://` plugin URL.
