# Released builds

Each `<version>/` folder holds a released, tested build. The GitHub Pages site
serves it unchanged at

`https://jonjoet.github.io/web-plugins/jbrowse-sequence-search/<version>/jbrowse-sequence-search.js`

Rules, all enforced in CI:

- **Never edit, rename or delete a released folder.** Web configurations and
  Desktop session files store the exact URL, and a Desktop session whose
  plugin URL fails will not open. Fix problems with a new version.
- A folder holds exactly `jbrowse-sequence-search.js`, its `.map`,
  `BUILD-INFO.json` (with `"sourceDirty": "no"`) and `SHA256SUMS`, copied
  unchanged from a clean build.
- While `package.json` names a released version, the source must still build
  byte-identically to that release. Changing plugin code therefore means
  bumping the version first.

To release, follow "Releasing a new plugin version" in
[../DEPLOYMENT.md](../DEPLOYMENT.md#releasing-a-new-plugin-version).
