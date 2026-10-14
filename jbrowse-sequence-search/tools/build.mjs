// Production build: one classic-script bundle that JBrowse loads as a "UMD"
// plugin (it reads the JBrowsePlugin<Name> global) on the main thread and in
// RPC workers. Shared libraries come from JBrowse's own JBrowseExports at run
// time; any other package import fails the build instead of being bundled.
//
// Output (versioned, ready to copy to a web server):
//   dist/jbrowse-sequence-search/<version>/jbrowse-sequence-search.js
//   dist/jbrowse-sequence-search/<version>/jbrowse-sequence-search.js.map
//   dist/jbrowse-sequence-search/<version>/BUILD-INFO.json
//   dist/jbrowse-sequence-search/<version>/SHA256SUMS
//   dist/jbrowse-sequence-search-<version>.tar.gz   (the directory above)
// Optional provenance: SOURCE_COMMIT and SOURCE_DIRTY environment variables.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const reexports = JSON.parse(readFileSync(join(root, 'tools/jbrowse-4.3.0-reexports.json'), 'utf8'));
const PLUGIN_NAME = 'GenomeSequenceSearch';
const fileName = `${pkg.name}.js`;
const outDir = join(root, 'dist', pkg.name, pkg.version);

const jbrowseExports = {
  name: 'jbrowse-exports',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, args => (reexports.modules.includes(args.path)
      ? { path: args.path, namespace: 'jbrowse-exports' }
      : { errors: [{ text: `"${args.path}" is not provided by JBrowse 4.3 (ReExports); refusing to bundle a private copy.` }] }));
    b.onLoad({ filter: /.*/, namespace: 'jbrowse-exports' }, args => ({
      contents: `module.exports = JBrowseExports[${JSON.stringify(args.path)}];`,
      loader: 'js',
    }));
  },
};

// Empty dist/ without removing it (it may be a bind mount).
mkdirSync(join(root, 'dist'), { recursive: true });
for (const entry of readdirSync(join(root, 'dist'))) rmSync(join(root, 'dist', entry), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/index.jsx'],
  outfile: join(outDir, fileName),
  bundle: true,
  format: 'iife',
  globalName: `JBrowsePlugin${PLUGIN_NAME}`,
  platform: 'browser',
  target: ['es2022', 'chrome120', 'firefox121', 'safari17'],
  jsx: 'automatic',
  minify: true,
  sourcemap: 'linked',
  sourcesContent: true,
  legalComments: 'eof',
  charset: 'utf8',
  metafile: true,
  banner: { js: `/*! ${pkg.name} ${pkg.version} — JBrowse plugin "${PLUGIN_NAME}" for JBrowse Web/Desktop 4.3.x */` },
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [jbrowseExports],
  logLevel: 'warning',
});

const bundled = Object.keys(result.metafile.inputs).filter(p => !p.startsWith('jbrowse-exports:'));
const externals = Object.keys(result.metafile.inputs).filter(p => p.startsWith('jbrowse-exports:')).map(p => p.slice('jbrowse-exports:'.length));
const info = {
  name: pkg.name,
  version: pkg.version,
  pluginName: PLUGIN_NAME,
  globalName: `JBrowsePlugin${PLUGIN_NAME}`,
  file: fileName,
  supportedJBrowse: '>=4.3.0 <4.4.0 (Web and Desktop)',
  sourceCommit: process.env.SOURCE_COMMIT || 'unknown',
  sourceDirty: process.env.SOURCE_DIRTY || 'unknown',
  esbuild: JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'), 'utf8')).version,
  node: process.version,
  jbrowseExports: externals.sort(),
  bundledSources: bundled.sort(),
};
writeFileSync(join(outDir, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`);

const sums = [fileName, `${fileName}.map`, 'BUILD-INFO.json']
  .map(f => `${createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')}  ${f}`);
writeFileSync(join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);

// Deterministic archive of the versioned directory.
const archive = join(root, 'dist', `${pkg.name}-${pkg.version}.tar.gz`);
execFileSync('sh', ['-c', 'tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - -C "$1" "$2" | gzip -n -9 > "$3"',
  'tar', join(root, 'dist'), join(pkg.name, pkg.version), archive]);
console.log(`Built ${join('dist', pkg.name, pkg.version, fileName)} (${readFileSync(join(outDir, fileName)).length} bytes)`);
console.log(`Archive dist/${pkg.name}-${pkg.version}.tar.gz`);
