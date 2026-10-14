# Design notes

This file records the decisions behind the plugin and the evidence for them.
Upstream references are to JBrowse **v4.3.0** (tag `v4.3.0`, commit
`3365240b9ad07ebcd2e060a745b5ebbc3120d773`), released 2026-05-21. That was
the newest stable release when this was written (5.0 was in beta). The
earlier read-only research looked at upstream commit
`b7c21a5f9bb32813b6e8b535373ad02e9cccf150`, a later development state. Files
named there that do not exist in 4.3.0, such as `plugins/blat`, were
therefore not used.

## Target versions

The user confirmed on 2026-10-14 that their Web deployment runs **4.3.x** and
Desktop users are meant to use **4.3.x**. Nothing in this repository pinned a
JBrowse version. The plugin is built against the 4.3.0 shared-module list,
and both 4.3.0 release builds were tested at runtime.

## Why not the built-in sequence search

`plugins/sequence/src/SequenceSearchAdapter/SequenceSearchAdapter.ts` (4.3.0):

- searches only the region being drawn, plus 10 kb on each side, with no
  whole-assembly list;
- builds `new RegExp(search, 'g')` from the user's text and uses
  `matchAll`, which skips overlapping matches. For example, `AA` in `AAAA`
  gives positions 0 and 2 but not 1 (checked in Node);
- treats input as a regular expression, so `N` means a literal N and `.`
  means any character;
- reports a palindromic site twice, once per strand.

The track it creates is dynamic. Spreadsheet view cannot open it, which is
the user's original problem; upstream issue GMOD/jbrowse-components#1549
added only BED/VCF-backed spreadsheet support. So this plugin adds its own
command and panel and leaves the built-in dialog untouched.

## Extension points used (all public in 4.3.0)

| Need | Mechanism |
| --- | --- |
| Tools menu entry | `rootModel.appendToMenu('Tools', …)` behind `isAbstractMenuManager` (developer guide *menus*) |
| View menu entry | `Core-extendPluggableElement` on `LinearGenomeView`, wrapping its `menuItems()` view (documented pattern) |
| Panel | `WidgetType` with an MST state model; `session.addWidget` / `showWidget` |
| Sequence access | Custom `RpcMethodType` that calls the registered core RPC element `CoreGetSequence` (`pluginManager.getRpcMethodType`). That method uses JBrowse's adapter cache, the assembly's configured sequence adapter, its auth and file handling, and stop tokens. Plugins cannot import `getAdapter` (not in `ReExports`), and delegating avoids bundling a second adapter cache. |
| Off-main-thread work | RPC methods run in JBrowse's web worker. 4.3.0 loads runtime plugins in the worker too (`product-core/src/rpcWorker.ts` → `PluginLoader`). The tests confirm the plugin file is fetched twice. |
| Results track | `session.addTrackConf` of a `FeatureTrack` with the plugin's own adapter type (`hiddenFromGUI`) |
| Navigation | `LinearGenomeView.navToLocations`, `showTrack`, `hideTrack`; a new view uses the `init` snapshot |
| Shared libraries | `JBrowseExports`; the build maps imports to it and fails on anything not in 4.3.0's list |

There is no DOM scraping, monkey-patching or reliance on private component
structure. The only JBrowse model members read are documented actions and
properties: `assemblyNames`, `views`, `tracks`, `widgets`,
`focusedViewId`, `assemblyManager.waitForAssembly`, `assembly.regions`,
`assembly.configuration.sequence.adapter`, and the view's
`assemblyNames`/`tracks`.

## Plugin loading (verified)

`packages/core/src/PluginLoader.ts`, 4.3.0: the UMD, ESM and CJS loaders each
throw unless the URL protocol is `http:` or `https:`. JBrowse Desktop 4.3.0
at runtime showed `cannot load plugins using protocol "file:"` for a
`file://` URL, and refused to open a session whose plugin URL was
unreachable. Desktop's *Add custom plugin* dialog takes a name and a UMD URL
and stores `{name, umdUrl}` in the session (`app-core` `addPlugin`). Desktop
then saves and reopens the session (`setPluginsUpdated`).

## Search algorithm

- **Query**: validated to A/C/G/T, or IUPAC codes when allowed. A
  fixed-length pattern is compiled from a whitelist: exact queries use
  repeated `indexOf` (step 1, so overlaps are found), and IUPAC queries use a
  zero-width lookahead `(?=[AG]C…)` advanced one position at a time. User
  text never becomes regular-expression source.
- **Strands**: the reverse strand is searched as the reverse complement of
  the query on the forward sequence, so every match has one forward-strand
  interval. When both strands match the same interval (a palindrome, or an
  IUPAC pattern), it is one hit with strand `0` ("both").
- **Chunks** (`src/search/chunks.js`): each contig is split into 1 Mb
  ownership ranges `[start, end)` for hit starts. The read range extends by
  `queryLength − 1` but never past the contig end. Each hit is owned by
  exactly one chunk, and no read crosses into another contig. Unit tests
  compare against brute force for chunk sizes 1…5000 on several contigs and
  queries.
- **Runner** (`src/search/run.js`): at most 2 chunk requests in flight;
  chunks are dispatched in genome order. A chunk returns at most
  `maxHits + 1` hits, which is enough to detect the limit. Only the
  contiguous prefix of finished chunks counts, so every coverage statement
  ("listed through chrX:N") is exact:
  - limit reached: the first 10,000 hits in genome order, labelled
    incomplete;
  - Stop: nothing new is dispatched, in-flight reads are aborted through
    JBrowse stop tokens, and results arriving after the abort are discarded;
  - failure: the error and the prefix are reported.
- **Replacement**: `src/search/coordinator.js` aborts the previous search and
  marks it stale, so a late result can never overwrite a newer search.
- **Caching**: no results cache. All reads go through the RPC session id
  `GenomeSequenceSearch`, so JBrowse's adapter cache, keyed by the adapter
  configuration, reuses one sequence adapter per assembly configuration in
  one worker. Results cannot come from the wrong assembly or sequence
  version because nothing is reused except JBrowse's own adapter.

## Results storage and session size

JBrowse Web 4.3.0 serializes the whole session on every change: it writes
`sessionStorage` synchronously and IndexedDB after a 400 ms delay
(`products/jbrowse-web/src/rootModel/rootModel.ts`). Inline feature objects
(`FromConfigAdapter`) would cost roughly 90 bytes per hit, re-serialized on
every scroll. This plugin instead stores one compact string (about 11 bytes
per hit; 10,000 human-scale hits measured 108 KB, and a unit test bounds it
under 160 KB) in the results
track's adapter configuration. The panel keeps only the track id, and the
list and the track both decode that one value. In the Web check, after
several searches including a 10,000-hit one, the session in
`sessionStorage` was about 128 K characters.

## Regular expressions

Not in this release. General regexes have unbounded match lengths, so the
chunk overlap is undefined. Overlapping matches need a different engine
from `matchAll`, and a single catastrophic pattern cannot be interrupted
inside the worker. A future version could accept a bounded subset with a
known maximum length, using the same chunk ownership rule.

## Circular sequences

JBrowse 4.3.0 assemblies and regions carry no topology field; a search of
`packages/core/src/assemblyManager`, `util/types` and `plugins/sequence`
found none. The plugin therefore treats every sequence as linear and does
not find origin-spanning matches. Supporting them would need an explicit
per-contig topology setting (for example, a plugin configuration listing
circular contigs) and a representation for a feature that wraps the origin.

## Performance (measured once, this environment)

Measured in JBrowse Web 4.3.0, headless Chromium, with a local
Range-capable server and a synthetic 250 Mb assembly (10 × 25 Mb):

- `GAATTCAAGG`: 486 matches in 12.9 s;
- a 20-mer with no matches: 6.6 s;
- main-thread long tasks: at most one, 59 ms; largest animation-frame gap:
  72 ms.

The worker scans about 8 ms/Mb for exact queries (Node microbenchmark), so
sequence transfer dominates. These numbers come from one scratch run; the
benchmark script is not part of the repository.
