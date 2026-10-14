# Deploying the genome sequence search plugin

The plugin is one static JavaScript file. Host it on your own web server,
next to your JBrowse Web deployment or anywhere your users' browsers and
JBrowse Desktop can reach over HTTP(S). GitHub Pages, unpkg, npm and the
public JBrowse plugin store are not involved.

- Plugin name: `GenomeSequenceSearch`. JBrowse reads the global
  `JBrowsePluginGenomeSequenceSearch`, and the name must match exactly.
- Format: what JBrowse calls a UMD plugin (a classic script). JBrowse loads it
  on the page and again in its web worker.
- Supported: JBrowse Web and Desktop **4.3.x**, tested with 4.3.0.

Nothing in this document has been deployed. Placeholders such as
`https://jbrowse.example.org` stand for your server.

## Artifacts

Build as described in [README.md](README.md#development). Build output:

```
dist/
  jbrowse-sequence-search/
    0.1.0/
      jbrowse-sequence-search.js       ← the plugin (≈29 KB)
      jbrowse-sequence-search.js.map   ← source map (optional to publish)
      BUILD-INFO.json                  ← version, source commit, dirty flag,
                                          JBrowse modules used, toolchain
      SHA256SUMS                       ← checksums of the three files above
  jbrowse-sequence-search-0.1.0.tar.gz ← the 0.1.0/ directory, for download
```

To publish a version, copy `dist/jbrowse-sequence-search/0.1.0/` to the same
path under a plugin directory on your server, for example:

```
/var/www/jbrowse/                      (your JBrowse Web 4.3.x files)
/var/www/jbrowse-plugins/jbrowse-sequence-search/0.1.0/jbrowse-sequence-search.js
```

Before copying, check the files:
`(cd dist/jbrowse-sequence-search/0.1.0 && sha256sum -c SHA256SUMS)`.

The tarball is the downloadable artifact: it holds exactly the versioned
directory, so `tar -xzf … -C /var/www/jbrowse-plugins` recreates the layout
above. Downloading the file alone is **not** enough for JBrowse Desktop.
Desktop loads plugins only from `http://` or `https://` URLs (see
[Offline Desktop use](#offline-desktop-use)).

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

## JBrowse Web

Add the plugin to the `plugins` section of your deployment's `config.json`.
A root-relative URL resolves against the JBrowse page, so it works for any
host name:

```json
{
  "plugins": [
    {
      "name": "GenomeSequenceSearch",
      "url": "/jbrowse-plugins/jbrowse-sequence-search/0.1.0/jbrowse-sequence-search.js"
    }
  ]
}
```

`url` and `umdUrl` are equivalent. An absolute
`https://jbrowse.example.org/...` URL also works. The JBrowse documentation
also describes `"umdLoc": { "uri": "..." }`, which resolves relative to
`config.json`; that form was not tested here.

Reload JBrowse. The plugin store (**Tools → Plugin store**) lists
*GenomeSequenceSearch (v0.1.0)* with a lock icon, and **Tools → Search
genome…** appears.

Users can also add the plugin to their own sessions through **Tools → Plugin
store → Add custom plugin**. That adds it to that session only, and JBrowse
warns about the session's plugins when such a session is reopened (per the
4.3.0 source). Use `config.json` for everyone.

The tested configuration is in [example/config.json](example/config.json),
with instructions in [example/README.md](example/README.md).

## JBrowse Desktop

Tested with JBrowse Desktop 4.3.0. Each user:

1. Opens their session (or creates one).
2. Chooses **Tools → Plugin store**, then **Add custom plugin**.
3. Enters **Plugin name** `GenomeSequenceSearch` and **Plugin URL**
   `https://jbrowse.example.org/jbrowse-plugins/jbrowse-sequence-search/0.1.0/jbrowse-sequence-search.js`.
   Leave *Advanced options* empty.
4. Presses **Submit**. Desktop saves and reloads the session; the plugin
   store then lists *GenomeSequenceSearch (v0.1.0)* under Installed plugins.
5. Uses **Tools → Search genome…**.

Desktop stores the plugin in that session's `.jbrowse` file
(`"plugins": [{"name": "GenomeSequenceSearch", "umdUrl": "…"}]`), and
reopening the session loads it again (tested). From the JBrowse 4.3.0 source,
the plugin belongs to that session's configuration, so other sessions need it
added the same way. This per-session scope is inferred from source, not
runtime-tested across new sessions.

You can also distribute a prepared `.jbrowse` session file that already
contains the `plugins` entry with your hosted URL.

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

- Copy `0.1.0/` to the laptop and serve it on the loopback interface, for
  example `python3 -m http.server 8731 --bind 127.0.0.1` from the directory
  that contains `jbrowse-sequence-search/0.1.0/`. Then add the plugin with
  `http://127.0.0.1:8731/jbrowse-sequence-search/0.1.0/jbrowse-sequence-search.js`.
  The server must be running whenever that session is opened. Plugin
  loading over `http://127.0.0.1` was tested; this particular command was
  not.
- **Recovering a session that will not open:** make the URL reachable again
  (connect to the network or start the local server). Alternatively, edit the
  `.jbrowse` file and remove the `GenomeSequenceSearch` entry from `plugins`.
  Results tracks in that session then show an *unknown adapter type* error
  until the plugin is added back; everything else works.

## Upgrading

### Releasing a new plugin version

1. Bump `version` in `package.json`; it becomes the directory name.
2. Build from a clean commit, so `BUILD-INFO.json` says
   `"sourceDirty": "no"`.
3. Run the unit tests and both browser checks
   ([README.md](README.md#browser-checks)) and save their reports.
4. Copy the new `x.y.z/` directory next to the old ones; never overwrite an
   existing version.
5. **Web:** change the URL in `config.json`. Sessions saved with
   `sessionPlugins` keep their own URL.
6. **Desktop:** users remove the old entry in the plugin store (trash icon)
   and add the new URL, or you distribute an updated `.jbrowse` file.
7. Results tracks keep working across plugin versions as long as the stored
   format (`formatVersion: 1`) is unchanged. A version that changes it must
   still read older results, or the panel will ask users to search again.

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
