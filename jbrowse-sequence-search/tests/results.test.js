import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeResults, encodeResults, stepIndex } from '../src/search/results.js';
import { formatLocation, navigationWindow, strandLabel } from '../src/search/format.js';
import { CONTIGS, searchMemory } from './helpers.js';

function searchMeta(query, extra = {}) {
  return {
    assemblyName: 'test', query, strandMode: 'both', ambiguous: false, allowAmbiguity: false,
    palindromic: false, regionCount: 4, totalBases: 97, maxHits: 10000, ...extra,
  };
}

test('stored results round-trip to the same hits in the same order', async () => {
  const outcome = await searchMemory(CONTIGS, 'AAA');
  const stored = encodeResults({ search: searchMeta('AAA'), outcome, createdAt: '2026-10-14T00:00:00Z' });
  assert.equal(typeof stored.hits, 'string');
  const decoded = decodeResults(JSON.parse(JSON.stringify(stored)));
  assert.equal(decoded.count, outcome.hits.length);
  assert.deepEqual(
    decoded.hits.map(({ refName, start, end, strand }) => ({ refName, start, end, strand })),
    outcome.hits.map(({ refName, start, end, strand }) => ({ refName, start, end, strand })),
  );
  assert.ok(decoded.hits.every(h => h.matched === 'AAA'));
  assert.deepEqual(decoded.hits.map(h => h.index), decoded.hits.map((_, i) => i));
});

test('ambiguity results keep per-hit matched bases', async () => {
  const outcome = await searchMemory(CONTIGS, 'GGNNCC', { withMatched: true });
  const stored = encodeResults({ search: searchMeta('GGNNCC', { ambiguous: true }), outcome });
  assert.deepEqual(stored.seqs, ['GGTACC', 'GGATCC']);
  assert.deepEqual(decodeResults(stored).hits.map(h => h.matched), ['GGTACC', 'GGATCC', 'GGATCC']);
});

test('stored size stays compact for large result sets', () => {
  const hits = Array.from({ length: 10000 }, (_, i) => ({ refName: `chr${i % 24}`, start: i * 300000, strand: [1, -1, 0][i % 3] }));
  const stored = encodeResults({ search: searchMeta('GAATTC'), outcome: { status: 'complete', hits, error: null, coveredThrough: null } });
  const bytes = JSON.stringify(stored).length;
  assert.ok(bytes < 160_000, `${bytes} bytes`);
});

test('damaged or unknown stored results are rejected, not misread', () => {
  const stored = encodeResults({ search: searchMeta('AC'), outcome: { status: 'complete', hits: [{ refName: 'x', start: 1, strand: 1 }], error: null, coveredThrough: null } });
  assert.throws(() => decodeResults({ ...stored, formatVersion: 99 }), /unsupported format/);
  assert.throws(() => decodeResults({ ...stored, hits: '5.1.+' }), /damaged/);
  assert.throws(() => decodeResults({ ...stored, count: 2 }), /incomplete/);
  assert.deepEqual(decodeResults({ ...stored, hits: '', count: 0 }).hits, []);
});

test('previous/next stepping is predictable and does not wrap', () => {
  assert.equal(stepIndex(-1, 5, 1), 0);
  assert.equal(stepIndex(-1, 5, -1), 4);
  assert.equal(stepIndex(0, 5, -1), 0);
  assert.equal(stepIndex(2, 5, 1), 3);
  assert.equal(stepIndex(4, 5, 1), 4);
  assert.equal(stepIndex(3, 0, 1), -1);
});

test('user-facing coordinates are 1-based and inclusive', () => {
  assert.equal(formatLocation('chr1', 0, 6), 'chr1:1-6');
  assert.equal(formatLocation('chr1', 1233, 1239), 'chr1:1,234-1,239');
  assert.deepEqual([1, -1, 0].map(strandLabel), ['+', '−', 'both']);
});

test('navigation adds flanking context clipped to the contig', () => {
  assert.deepEqual(navigationWindow({ start: 1000, end: 1006 }, 0, 5000), { start: 950, end: 1056 });
  assert.deepEqual(navigationWindow({ start: 10, end: 16 }, 0, 40), { start: 0, end: 40 });
  assert.deepEqual(navigationWindow({ start: 1000, end: 1200 }, 0, 5000), { start: 800, end: 1400 });
});
