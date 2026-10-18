# Deploying the genome sequence search plugin

The plugin is one static JavaScript file, served over HTTP(S). There are two
ways to host it:

- **This repository's GitHub Pages site**, which serves every plugin in the
  repository at once. See [GitHub Pages](#github-pages). The released URL
  for 0.1.1 is
  `https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`
  once the site is deployed from `main`.
- **Your own web server**, next to your JBrowse Web deployment or anywhere
  your users' browsers and JBrowse Desktop can reach. Pages is optional; the
  same versioned folder works from any static host.

unpkg, npm and the public JBrowse plugin store are not involved.

- Plugin name: `GenomeSequenceSearch`. JBrowse reads the global
  `JBrowsePluginGenomeSequenceSearch`, and the name must match exactly.
- Format: what JBrowse calls a UMD plugin (a classic script). JBrowse loads it
  on the page and again in its web worker.
- Supported: JBrowse Web and Desktop **4.3.x**, tested with 4.3.0.

Nothing in this document has been deployed yet. Placeholders such as
`https://jbrowse.example.org` stand for your server.

## Artifacts

Build as described in [README.md](README.md#development). Build output:

```
dist/
  jbrowse-sequence-search/
    0.1.1/
      jbrowse-sequence-search.js       ← the plugin (≈29 KB)
      jbrowse-sequence-search.js.map   ← source map (optional to publish)
      BUILD-INFO.json                  ← version, source commit, dirty flag,
                                          JBrowse modules used, toolchain
      SHA256SUMS                       ← checksums of the three files above
  jbrowse-sequence-search-0.1.1.tar.gz ← the 0.1.1/ directory, for download
```

To publish a version, copy `dist/jbrowse-sequence-search/0.1.1/` to the same
path under a plugin directory on your server, for example:

```
/var/www/jbrowse/                      (your JBrowse Web 4.3.x files)
/var/www/jbrowse-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js
```

Before copying, check the files:
`(cd dist/jbrowse-sequence-search/0.1.1 && sha256sum -c SHA256SUMS)`.

The tarball is the downloadable artifact: it holds exactly the versioned
directory, so `tar -xzf … -C /var/www/jbrowse-plugins` recreates the layout
above. Downloading the file alone is **not** enough for JBrowse Desktop.
Desktop loads plugins only from `http://` or `https://` URLs (see
[Offline Desktop use](#offline-desktop-use)).

**Who downloads the plugin:** each user's own browser (Web) or JBrowse
Desktop app, never your JBrowse server. On Web, the server only hands out
static files; the browser reads the plugin URL from `config.json` and
downloads the file twice per page load, once for the page and once for
JBrowse's web worker (seen in testing). Desktop downloads it every time a
session opens. So the URL must be reachable from every user's machine.
Whoever hosts it, for example GitHub for the Pages URL, sees those requests.

Server requirements:

- Serve `.js` as `text/javascript` (or `application/javascript`). Browsers
  refuse worker scripts with other MIME types.
- If JBrowse Web uses `https://`, the plugin URL must use `https://` too
  (browsers block mixed content).
- The plugin needs no CORS headers to be loaded as a script. Serving it from
  the same origin as JBrowse Web is simplest.
- Versioned paths never change content, so they can be cached for a long
  time. **Keep old versions on the server**: Desktop sessions store the exact
  URL, and a session whose plugin URL fails will not open.

## GitHub Pages

The repository has one Pages site, served at `https://jonjoet.github.io/web-plugins/`.
A Pages deployment replaces the whole site, so all plugins are built and
staged together by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

1. It runs each plugin's checks (the per-plugin workflows, reused).
2. It builds the Trello Power-Up with its configured key.
3. It stages the site with [`site/stage-site.sh`](../site/stage-site.sh):
   `trello-check-date/` from the Trello build, and every folder in
   [`releases/`](releases/) as `jbrowse-sequence-search/<version>/`, with
   checksums verified.
4. It deploys that single site.

The workflow runs on pushes to `main` that touch either plugin, `site/` or the
workflows, and can also be started by hand. Deployment stays behind the
existing repository variable `TRELLO_PAGES_ENABLED=true`, which now gates the
whole site. Pull requests only run checks and never deploy.

The site serves what is committed in `releases/`, never a fresh build:

| URL | Contents |
| --- | --- |
| `https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js` | the plugin |
| `…/0.1.1/jbrowse-sequence-search.js.map` | source map |
| `…/0.1.1/BUILD-INFO.json`, `…/0.1.1/SHA256SUMS` | provenance and checksums |

Pages serves `.js` as JavaScript over HTTPS, so both JBrowse Web (including
an `https://` deployment on another host) and Desktop can load it. Notes:

- The site is public, even for a private repository. The plugin contains no
  secrets.
- When Pages is the host, plugin availability depends on GitHub. For Desktop
  this matters more, because a session whose plugin URL fails will not open.
  You can mirror the same folder on your own server and use that URL instead.
- Each release folder holds exactly a verified build, with the same
  checksums: `releases/0.1.1/` from
  [`verification/2026-10-18-6865501/`](verification/2026-10-18-6865501/), and
  `releases/0.1.0/` from
  [`verification/2026-10-14-bca512d/`](verification/2026-10-14-bca512d/).

## JBrowse Web

Add the plugin to the `plugins` section of your deployment's `config.json`.
A root-relative URL resolves against the JBrowse page, so it works for any
host name:

```json
{
  "plugins": [
    {
      "name": "GenomeSequenceSearch",
      "url": "/jbrowse-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js"
    }
  ]
}
```

`url` and `umdUrl` are equivalent. An absolute URL also works, including
the Pages URL
`https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`
if you prefer not to copy the file onto your JBrowse server. The JBrowse documentation
also describes `"umdLoc": { "uri": "..." }`, which resolves relative to
`config.json`; that form was not tested here.

Reload JBrowse. The plugin store (**Tools → Plugin store**) lists
*GenomeSequenceSearch (v0.1.1)* with a lock icon, and **Tools → Search
genome…** appears.

On JBrowse Web 4.3.0, ordinary users cannot add plugins themselves: the
Plugin store shows **Add custom plugin** only in admin mode (a page opened
with an `adminKey`, as used by `jbrowse admin-server`; checked in the 4.3.0
source). So for Web, the plugin goes in `config.json`, and then everyone has
it.

The tested configuration is in [example/config.json](example/config.json),
with instructions in [example/README.md](example/README.md).

## JBrowse Desktop

Tested with JBrowse Desktop 4.3.0. Each user:

1. Opens their session (or creates one).
2. Chooses **Tools → Plugin store**, then **Add custom plugin**.
3. Enters **Plugin name** `GenomeSequenceSearch` and **Plugin URL**
   `https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`
   (Pages), or your own server's URL for the same folder. Leave *Advanced
   options* empty.
4. Presses **Submit**. Desktop saves and reloads the session; the plugin
   store then lists *GenomeSequenceSearch (v0.1.1)* under Installed plugins.
   If nothing seems to happen, see
   [If Submit does nothing](#if-submit-does-nothing).
5. Uses **Tools → Search genome…**.

Desktop stores the plugin in that session's `.jbrowse` file
(`"plugins": [{"name": "GenomeSequenceSearch", "umdUrl": "…"}]`), and
reopening the session loads it again (tested). From the JBrowse 4.3.0 source,
the plugin belongs to that session's configuration, so other sessions need it
added the same way. This per-session scope is inferred from source, not
runtime-tested across new sessions.

You can also distribute a prepared `.jbrowse` session file that already
contains the `plugins` entry with your hosted URL.

### If Submit does nothing

JBrowse Desktop 4.3.0 gives no error message when the plugin cannot be
loaded. After **Submit**, the dialog stays open, the plugin is not listed
under Installed plugins, and the session looks unchanged. This was
reproduced with a wrong plugin name and with an unreachable URL. Check:

- **Name**: exactly `GenomeSequenceSearch` (case matters). It is not the file
  or folder name.
- **URL**: it opens in a normal browser on the same machine and shows
  JavaScript starting with `/*! jbrowse-sequence-search`.

The failed entry is still saved into that session's file. When the session
is next opened, Desktop refuses to open it and the start screen shows, for
example,
`Error: Failed to load UMD bundle for jbrowse-sequence-search, JBrowsePluginjbrowse-sequence-search is undefined`
(wrong name) or `Error: Failed to load script: …` (unreachable URL). To fix
the session, open its `.jbrowse` file in a text editor, delete the bad entry
from `"plugins": [ … ]`, and optionally add the correct one:

```json
{ "name": "GenomeSequenceSearch", "umdUrl": "https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js" }
```

A session you never saved under a name is kept as one of Desktop's
autosaves. On Linux these were under `~/.config/JBrowse 2/` in testing; on
macOS and Windows they are in Desktop's application-data folder (path not
verified).

### Offline Desktop use

What was verified in JBrowse Desktop 4.3.0:

- A `file://` plugin URL is rejected with
  `cannot load plugins using protocol "file:"`. All three of JBrowse 4.3.0's
  plugin loaders (UMD, ESM, CJS) accept only `http:` and `https:`.
- If a session's plugin URL cannot be reached when the session opens, Desktop
  does not open that session. The start screen shows
  `Error: Failed to load script: <url>`.

Ordinary users need neither a local server nor any of this: they use your
hosted URL while they can reach it. For offline use:

- **With Docker** (tested): run the plugin site on the laptop with
  [`site/compose.yaml`](../site/compose.yaml) (`docker compose up -d --build`
  in `site/`; see [site/README.md](../site/README.md)). Then add the plugin
  with
  `http://127.0.0.1:8731/web-plugins/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`.
  It restarts with Docker (`restart: unless-stopped`), but Docker must be
  running whenever that session is opened. JBrowse Desktop 4.3.0 loaded the
  plugin from this setup and searched successfully.
- **Without Docker**: any static server on the loopback interface works, for
  example `python3 -m http.server 8731 --bind 127.0.0.1` from the directory
  that contains `jbrowse-sequence-search/0.1.1/`, with
  `http://127.0.0.1:8731/jbrowse-sequence-search/0.1.1/jbrowse-sequence-search.js`.
  The Python command itself was not tested.
- A session stores one plugin URL. A session saved with the localhost URL
  works only where that server runs; one saved with the Pages URL needs
  internet. To switch a session, edit `umdUrl` in its `.jbrowse` file.
- **Recovering a session that will not open:** make the URL reachable again
  (connect to the network or start the local server). Alternatively, edit the
  `.jbrowse` file and remove the `GenomeSequenceSearch` entry from `plugins`.
  Results tracks in that session then show an *unknown adapter type* error
  until the plugin is added back; everything else works.

## Upgrading

### Releasing a new plugin version

1. Bump `version` in `package.json` **before changing plugin code**; it
   becomes the directory name. CI fails if the source no longer builds
   byte-identically to the release of the current version.
2. Commit, then build from that clean commit, so `BUILD-INFO.json` says
   `"sourceDirty": "no"` and names the commit.
3. Run the unit tests and both browser checks
   ([README.md](README.md#browser-checks)). Save their reports under
   `verification/<date>-<commit>/`.
4. Copy `dist/jbrowse-sequence-search/<version>/` unchanged to
   `releases/<version>/`, and run `npm run check:releases`. Commit it. CI
   refuses any later edit, rename or deletion of a released folder.
5. Hosting: merging to `main` publishes the new folder on Pages next to the
   old ones. On your own server, copy it next to the old versions and never
   overwrite one.
6. **Web:** change the URL in `config.json`. Sessions saved with
   `sessionPlugins` keep their own URL.
7. **Desktop:** users remove the old entry in the plugin store (trash icon)
   and add the new URL, or you distribute an updated `.jbrowse` file.
8. Results tracks keep working across plugin versions as long as the stored
   format (`formatVersion: 1`) is unchanged. A version that changes it must
   still read older results, or the panel will ask users to search again.

### Moving to a newer plugin version

[CHANGELOG.md](CHANGELOG.md) lists each version's changes and its upgrade
steps. In short: change the version in the URL in Web's `config.json`, and
in each Desktop session replace the plugin entry. Old versions stay on the
site, so sessions you don't update keep working.

### Upgrading JBrowse

The plugin is built and tested against JBrowse **4.3.0**. Before moving your
Web deployment or Desktop users to another JBrowse version:

1. Download the new `jbrowse-web-vX.Y.Z.zip` and the Desktop AppImage and run
   both browser checks against them.
2. Review the new release's changelog for anything that touches these:
   - plugin loading (`PluginLoader`, `JBrowseExports`);
   - the `CoreGetSequence` RPC method;
   - `RpcMethodType`;
   - `Core-extendPluggableElement`;
   - the Linear Genome View's menu and navigation methods;
   - session widgets and tracks.
3. Compare the new `packages/core/src/ReExports/list.ts` with
   `tools/jbrowse-4.3.0-reexports.json`. The build refuses imports that
   JBrowse does not provide.
4. If anything fails, keep the old JBrowse version, or fix and release a new
   plugin version. Record the newly tested range in README.md.

**JBrowse 5.0** is in beta (5.0.0-beta.13 at the time of writing) and changes
plugin packaging. It is not supported until it is tested as above.
