// Deterministic test genomes and a small static HTTP server (with Range
// support, like a production web server) for the browser checks.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { randomDna } from '../helpers.js';
import { reverseComplement } from '../../src/search/iupac.js';

// 20 bp, not palindromic, absent from the random background.
export const QUERY = 'ACGTTGCATGCAGTCCTAGG';
const RC = reverseComplement(QUERY);

function plant(seq, at, insert) {
  return seq.slice(0, at) + insert + seq.slice(at + insert.length);
}

export function buildGenomes() {
  let ctgA = randomDna(2_100_000, 101);
  ctgA = plant(ctgA, 1_000, QUERY); // visible at start
  ctgA = plant(ctgA, 999_990, QUERY); // crosses the 1,000,000 chunk boundary
  ctgA = plant(ctgA, 2_100_000 - 20, RC); // reverse strand, ends at contig end
  let ctgB = randomDna(60_000, 202);
  ctgB = plant(ctgB, 0, QUERY.toLowerCase()); // soft-masked, contig start
  ctgB = plant(ctgB, 5_000, RC);
  ctgB = plant(ctgB, 60_000 - 10, QUERY.slice(0, 10)); // first half at ctgB end...
  let ctgC = randomDna(40_000, 303);
  ctgC = plant(ctgC, 0, QUERY.slice(10)); // ...second half at ctgC start: no match
  ctgC = plant(ctgC, 300, QUERY);
  const other = plant(randomDna(10_000, 404), 42, QUERY);
  return {
    testgenome: { ctgA, ctgB, ctgC },
    othergenome: { otherChr: other },
    // Served slowly to test stopping and replacing a running search.
    slowgenome: { slow1: randomDna(4_000_000, 505), slow2: randomDna(2_000_000, 606) },
  };
}

// Expected hits for QUERY in testgenome, in genome order, 0-based half-open.
export const EXPECTED = [
  { refName: 'ctgA', start: 1_000, end: 1_020, strand: 1 },
  { refName: 'ctgA', start: 999_990, end: 1_000_010, strand: 1 },
  { refName: 'ctgA', start: 2_099_980, end: 2_100_000, strand: -1 },
  { refName: 'ctgB', start: 0, end: 20, strand: 1 },
  { refName: 'ctgB', start: 5_000, end: 5_020, strand: -1 },
  { refName: 'ctgC', start: 300, end: 320, strand: 1 },
];

// Writes <name>.fa and <name>.fa.fai (60 bases per line).
export async function writeFasta(dir, name, contigs) {
  await mkdir(dir, { recursive: true });
  let fasta = '';
  let fai = '';
  for (const [refName, seq] of Object.entries(contigs)) {
    const header = `>${refName}\n`;
    const offset = Buffer.byteLength(fasta) + header.length;
    fasta += header;
    for (let i = 0; i < seq.length; i += 60) fasta += `${seq.slice(i, i + 60)}\n`;
    fai += `${refName}\t${seq.length}\t${offset}\t60\t61\n`;
  }
  await writeFile(join(dir, `${name}.fa`), fasta);
  await writeFile(join(dir, `${name}.fa.fai`), fai);
}

export function assemblyConfig(name, uriBase) {
  return {
    name,
    sequence: {
      type: 'ReferenceSequenceTrack',
      trackId: `${name}-reference`,
      adapter: {
        type: 'IndexedFastaAdapter',
        fastaLocation: { uri: `${uriBase}/${name}.fa`, locationType: 'UriLocation' },
        faiLocation: { uri: `${uriBase}/${name}.fa.fai`, locationType: 'UriLocation' },
      },
    },
  };
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
};

// mounts: { '/prefix/': '/abs/dir' }. Logs every request path.
// options.delay(path) may return milliseconds to wait before responding (used
// to make searches slow enough to stop or replace).
export async function serve(mounts, log = [], options = {}) {
  const entries = Object.entries(mounts).map(([prefix, dir]) => [prefix, resolve(dir)]);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    log.push(path);
    const wait = options.delay?.(path) ?? 0;
    if (wait) await new Promise(r => setTimeout(r, wait));
    const mount = entries.find(([prefix]) => path.startsWith(prefix));
    if (!mount) { res.writeHead(404).end(); return; }
    let file = resolve(mount[1], `.${sep}${path.slice(mount[0].length)}`);
    if (!file.startsWith(mount[1])) { res.writeHead(403).end(); return; }
    try {
      let info = await stat(file);
      if (info.isDirectory()) { file = join(file, 'index.html'); info = await stat(file); }
      const headers = {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache',
      };
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1);
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
        createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, 'content-length': info.size });
        createReadStream(file).pipe(res);
      }
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
