// Checks the committed release folders (releases/<version>/), which the
// GitHub Pages site serves at versioned URLs that Desktop sessions store:
//   - every release has its four files, its checksums verify, and its
//     BUILD-INFO names the same version and a clean source tree;
//   - if the current package version has a release folder, the fresh build
//     in dist/ is byte-identical to it, so a release always matches source.
// Run after `npm run build`. Immutability of published folders is checked
// separately in CI (git history is not available in the Docker image).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const releases = join(root, 'releases');
const FILES = ['jbrowse-sequence-search.js', 'jbrowse-sequence-search.js.map', 'BUILD-INFO.json', 'SHA256SUMS'];
const problems = [];
const sha = buf => createHash('sha256').update(buf).digest('hex');

const versions = readdirSync(releases, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
if (!versions.length) problems.push('releases/ contains no versions');
for (const version of versions) {
  const dir = join(releases, version);
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${version}: folder name is not a version number`);
  const missing = FILES.filter(f => !existsSync(join(dir, f)));
  if (missing.length) { problems.push(`${version}: missing ${missing.join(', ')}`); continue; }
  const extra = readdirSync(dir).filter(f => !FILES.includes(f));
  if (extra.length) problems.push(`${version}: unexpected files ${extra.join(', ')}`);
  for (const line of readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [hash, file] = line.split(/\s+/);
    if (sha(readFileSync(join(dir, file))) !== hash) problems.push(`${version}: checksum mismatch for ${file}`);
  }
  const info = JSON.parse(readFileSync(join(dir, 'BUILD-INFO.json'), 'utf8'));
  if (info.version !== version) problems.push(`${version}: BUILD-INFO says version ${info.version}`);
  if (info.sourceDirty !== 'no') problems.push(`${version}: built from a dirty or unknown tree (sourceDirty: ${info.sourceDirty})`);
}

const current = join(releases, pkg.version);
if (existsSync(current)) {
  const built = join(root, 'dist', pkg.name, pkg.version);
  for (const file of ['jbrowse-sequence-search.js', 'jbrowse-sequence-search.js.map']) {
    const path = join(built, file);
    if (!existsSync(path)) { problems.push(`dist has no ${file}; run npm run build first`); continue; }
    if (sha(readFileSync(path)) !== sha(readFileSync(join(current, file)))) {
      problems.push(`${pkg.version}: the current source builds a different ${file} than the released one. Bump the version in package.json for changed plugin code.`);
    }
  }
} else {
  console.log(`Version ${pkg.version} is not released yet (no releases/${pkg.version}/).`);
}

if (problems.length) {
  console.error(`Release check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Release check passed: ${versions.join(', ')}`);
