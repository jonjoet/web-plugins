# Manual JBrowse Desktop check (about 10 minutes)

The automated check ran the Linux build of JBrowse Desktop 4.3.0 against a
local test server. This checklist covers what it could not: your operating
system and your hosted URL. Use JBrowse Desktop **4.3.x** (Help → About).

## Prepare

1. Use the Pages URL, or copy `releases/0.1.0/` (or the unpacked release
   archive) to your server, e.g.
   `https://YOUR-SERVER/jbrowse-plugins/jbrowse-sequence-search/0.1.0/`.
2. Open the plugin URL in a normal browser. It should show JavaScript
   starting with `/*! jbrowse-sequence-search 0.1.0`.
3. Optional test data: copy `example/data/` from this repository to the
   server. In Desktop, add it with **File → Open assembly…**: name
   `example`, FASTA `https://YOUR-SERVER/…/example.fa` and index
   `https://YOUR-SERVER/…/example.fa.fai` (indexed FASTA). Alternatively, use
   any genome you normally open in Desktop.

## Steps and expected results

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open a session with a genome. **Tools → Plugin store → Add custom plugin**. Name `GenomeSequenceSearch` (exactly), URL `https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.0/jbrowse-sequence-search.js` or your own server's. **Submit**. | The session reloads. The plugin store lists *GenomeSequenceSearch (v0.1.0)* under Installed plugins. If nothing happens, the name or URL is wrong and a bad entry was saved: see [If Submit does nothing](../DEPLOYMENT.md#if-submit-does-nothing). |
| 2 | **Tools → Search genome…** | A *Search genome* panel opens on the right. The assembly is the one in your view, and the text says it searches all N sequences of that assembly. |
| 3 | Paste a sequence you know occurs on more than one chromosome. For the example genome use `ACGTTGCATGCAGTCCTAGG`. Press **Search**. | A progress bar, then a green *Found N matches* message. The example gives 3 matches: chr1:2,001-2,020 (+), chr1:15,001-15,020 (−), chr2:7,981-8,000 (+). A *Search: …* track appears in the view. |
| 4 | Click a row on another chromosome. | The view jumps there; the match is centred with flanking sequence and drawn in the results track. |
| 5 | Press **Next** and **Previous** a few times. | The view steps through the matches in list order; the text shows *Match k of N*. |
| 6 | Paste `GAATTC` and search. | Each site has strand *both*, and a note explains why. |
| 7 | Paste `GANTC`. | An error explains the ambiguity code; **Search** is disabled until *Allow ambiguity codes* is ticked. |
| 8 | On a large genome, start a search and press **Stop**. | An amber *Incomplete: search stopped …* message. |
| 9 | Quit Desktop with **File → Exit** (Desktop saves the session file itself), start it again, open the session from *Recently opened sessions* or **File → Open session…**, then **Tools → Search genome…**. | The last results are listed again and the results track is present. |
| 10 | Optional: **File → Return to start screen**, open a different genome, and look at **Tools**. | Expected from source, not yet tested: *Search genome…* is missing until the plugin is added to that session too. Please note what you see. |

Please report the Desktop version and operating system, the step number of
anything unexpected, and the message shown. Screenshots help. Remove
private paths and server names first if needed.
