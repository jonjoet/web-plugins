import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/search/query.js';
import { scanText } from '../src/search/scan.js';
import { planChunks } from '../src/search/chunks.js';
import { reverseComplement } from '../src/search/iupac.js';
import { CONTIGS, bruteForce, randomDna, searchMemory, strip } from './helpers.js';

test('palindromic site is reported once per location, as both strands', async () => {
  const q = parseQuery('GAATTC');
  assert.equal(q.palindromic, true);
  const { status, hits } = await searchMemory(CONTIGS, q.sequence);
  assert.equal(status, 'complete');
  assert.deepEqual(strip(hits), [
    { refName: 'chrA', start: 0, end: 6, strand: 0 }, // contig start
    { refName: 'chrA', start: 20, end: 26, strand: 0 },
    { refName: 'chrB', start: 1, end: 7, strand: 0 }, // soft-masked
    { refName: 'chrB', start: 34, end: 40, strand: 0 }, // ends at contig end
    { refName: 'chrD', start: 5, end: 11, strand: 0 }, // ends at contig end
  ]);
});

test('palindromic query on one strand is reported on that strand only', async () => {
  const forward = await searchMemory(CONTIGS, 'GAATTC', { strandMode: 'forward' });
  assert.deepEqual(forward.hits.map(h => h.strand), [1, 1, 1, 1, 1]);
  const reverse = await searchMemory(CONTIGS, 'GAATTC', { strandMode: 'reverse' });
  assert.deepEqual(reverse.hits.map(h => h.strand), [-1, -1, -1, -1, -1]);
});

test('overlapping occurrences are all found on both strands', async () => {
  const { hits } = await searchMemory({ chrA: CONTIGS.chrA }, 'AAA');
  assert.deepEqual(strip(hits).map(h => [h.start, h.strand]), [
    [16, -1], [17, -1], // tttt read as AAA on the reverse strand
    [32, 1], [33, 1], [34, 1], [35, 1], // AAAAAA
  ]);
});

test('reverse-strand matches use the forward-strand interval', async () => {
  const { hits } = await searchMemory(CONTIGS, 'TTTTTT');
  assert.deepEqual(strip(hits), [
    { refName: 'chrA', start: 32, end: 38, strand: -1 },
    { refName: 'chrB', start: 13, end: 19, strand: -1 },
  ]);
  assert.equal(CONTIGS.chrA.slice(32, 38), reverseComplement('TTTTTT'));
});

test('forward-only match and mixed-case query', async () => {
  const q = parseQuery('aaaaAAgg');
  assert.equal(q.sequence, 'AAAAAAGG');
  const { hits } = await searchMemory(CONTIGS, q.sequence);
  assert.deepEqual(strip(hits), [{ refName: 'chrB', start: 13, end: 21, strand: 1 }]);
});

test('no matches is a complete search with zero hits', async () => {
  const result = await searchMemory(CONTIGS, 'CCCCCCCC');
  assert.equal(result.status, 'complete');
  assert.equal(result.hits.length, 0);
  assert.equal(result.coveredThrough, null);
});

test('matches never span two contigs', async () => {
  // chrA ends "...GAATT" and chrB starts "cgaattc": joined they would contain
  // GAATTCG across the boundary.
  const joined = CONTIGS.chrA + CONTIGS.chrB;
  assert.ok(joined.toUpperCase().includes('GAATTCGAATT'));
  const { hits } = await searchMemory({ chrA: CONTIGS.chrA, chrB: CONTIGS.chrB }, 'TTCGAA');
  assert.equal(hits.length, 0);
});

test('chunking never loses or duplicates matches', async () => {
  const contigs = {
    one: randomDna(3000, 7),
    two: randomDna(1777, 11),
    tiny: 'ACG',
  };
  // Plant occurrences, including overlapping ones.
  contigs.one = contigs.one.slice(0, 999) + 'ACGTACGTACGT' + contigs.one.slice(1011);
  for (const query of ['ACGTACGT', 'GATC', 'AAAAA', 'T']) {
    for (const strandMode of ['both', 'forward', 'reverse']) {
      const expected = bruteForce(contigs, query, strandMode);
      for (const chunkSize of [1, 2, 3, 7, 8, 9, 64, 1000, 1001, 5000]) {
        const { status, hits } = await searchMemory(contigs, query, { strandMode, chunkSize, concurrency: 3, maxHits: 1e6 });
        assert.equal(status, 'complete');
        assert.deepEqual(strip(hits), expected, `${query} ${strandMode} chunk ${chunkSize}`);
      }
    }
  }
});

test('a hit straddling a chunk boundary is reported exactly once', () => {
  const chunks = planChunks([{ refName: 'c', start: 0, end: 20 }], { queryLength: 4, chunkSize: 10 });
  assert.deepEqual(chunks.map(c => [c.start, c.end, c.fetchStart, c.fetchEnd]), [[0, 10, 0, 13], [10, 17, 10, 20]]);
  const seq = 'CCCCCCCCGATCCCCCCCCC'; // GATC at 8..12 crosses 10
  const parts = chunks.map(c => scanText(seq.slice(c.fetchStart, c.fetchEnd), c.fetchStart, 'GATC', 'both', c.start, c.end));
  assert.deepEqual(parts.map(p => p.starts), [[8], []]);
  assert.equal(chunks.reduce((s, c) => s + c.bases, 0), 20);
});

test('contigs shorter than the query are skipped but counted as searched', async () => {
  const chunks = planChunks([{ refName: 'short', start: 0, end: 3 }, { refName: 'long', start: 0, end: 10 }], { queryLength: 4 });
  assert.deepEqual(chunks.map(c => c.refName), ['long']);
  const progress = [];
  const { runSearch } = await import('../src/search/run.js');
  await runSearch({
    chunks, queryLength: 4, totalBases: 13, onProgress: p => progress.push(p.scannedBases),
    scanChunk: async () => ({ starts: [], strands: [] }),
  });
  assert.deepEqual(progress, [13]);
});

test('IUPAC ambiguity codes match their base sets, never reference N', async () => {
  const q = parseQuery('GGNNCC', { allowAmbiguity: true });
  assert.ok(q.ok && q.ambiguous && q.palindromic);
  const { hits } = await searchMemory(CONTIGS, q.sequence, { withMatched: true });
  assert.deepEqual(hits.map(h => [h.refName, h.start, h.strand, h.matched]), [
    ['chrA', 10, 0, 'GGTACC'],
    ['chrB', 7, 0, 'GGATCC'],
    ['chrB', 19, 0, 'GGATCC'],
  ]);
  // chrA has T T n n n n A A at 26: query N does not match the reference gap.
  const gap = await searchMemory({ chrA: CONTIGS.chrA }, 'TTNNNNAA');
  assert.equal(gap.hits.length, 0);
  // ...but N matches concrete bases, as in chrD's TTTTTGAA.
  const real = await searchMemory({ chrD: CONTIGS.chrD }, 'TTNNNNAA');
  assert.deepEqual(strip(real.hits), [{ refName: 'chrD', start: 0, end: 8, strand: 0 }]);
});

test('non-palindromic ambiguity query reports matched bases per strand', async () => {
  const contigs = { x: 'AAGAATTTAAAAATTCAA' };
  const { hits } = await searchMemory(contigs, 'GAATTY', { withMatched: true });
  // forward GAATTT at 2; reverse RAATTC = AAATTC at 10, read on − as GAATTT
  assert.deepEqual(hits.map(h => [h.start, h.strand, h.matched]), [[2, 1, 'GAATTT'], [10, -1, 'GAATTT']]);
  assert.deepEqual(strip(hits), bruteForce(contigs, 'GAATTY'));
});

test('ambiguity query equals brute force on random sequence', async () => {
  const contigs = { r: randomDna(4000, 99) };
  for (const query of ['RYN', 'GANTC', 'WWWW', 'NNNNNN', 'ACGTN']) {
    const { hits } = await searchMemory(contigs, query, { chunkSize: 333, maxHits: 1e6 });
    assert.deepEqual(strip(hits), bruteForce(contigs, query), query);
  }
});

test('per-chunk hit cap keeps the first hits and still detects the limit', async () => {
  const seq = 'ATATATATAT';
  const all = scanText(seq, 100, 'AT', 'both', 100, 109);
  assert.deepEqual(all.starts, [100, 102, 104, 106, 108]);
  const capped = scanText(seq, 100, 'AT', 'both', 100, 109, false, 4);
  assert.deepEqual(capped.starts, all.starts.slice(0, 4));
  assert.deepEqual(capped.strands, all.strands.slice(0, 4));
  const contigs = { a: 'A'.repeat(500), b: 'A'.repeat(500) };
  const uncapped = await searchMemory(contigs, 'AA', { chunkSize: 300, maxHits: 400, chunkLimit: Infinity });
  const limited = await searchMemory(contigs, 'AA', { chunkSize: 300, maxHits: 400 });
  assert.equal(limited.status, 'limit');
  assert.deepEqual(limited.hits, uncapped.hits);
  assert.deepEqual(limited.coveredThrough, uncapped.coveredThrough);
});
