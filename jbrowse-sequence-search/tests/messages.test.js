import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeMessage, queryHeading, scopeText } from '../src/search/messages.js';
import { featureData, FEATURE_SEQUENCE_MAX } from '../src/search/features.js';
import { shortSequence } from '../src/search/format.js';
import { randomDna, searchMemory } from './helpers.js';

const base = { assemblyName: 'hg38', regionCount: 25, totalBases: 3_100_000_000, strandMode: 'both', status: 'complete', count: 3, maxHits: 10000 };

test('scope wording uses the singular for a one-sequence assembly', () => {
  assert.equal(scopeText(base), 'all 25 sequences of hg38 (3.10 Gb), both strands');
  assert.equal(scopeText({ ...base, assemblyName: 'phiX', regionCount: 1, totalBases: 5386, strandMode: 'forward' }),
    'the 1 sequence of phiX (5,386 bp), the forward (+) strand only');
  assert.equal(outcomeMessage({ ...base, regionCount: 1, count: 1 }).text,
    'Found 1 match. Searched the 1 sequence of hg38 (3.10 Gb), both strands.');
  assert.equal(outcomeMessage({ ...base, count: 0 }).text, 'No matches. Searched all 25 sequences of hg38 (3.10 Gb), both strands.');
});

test('long sequences are shortened for display, short ones unchanged', () => {
  assert.equal(shortSequence('ACGT', 10), 'ACGT');
  const long = `${'A'.repeat(50)}${'C'.repeat(9_900)}${'G'.repeat(50)}`;
  assert.equal(shortSequence(long, 100), `${'A'.repeat(44)}…${'G'.repeat(44)} (10,000 bp)`);
  assert.equal(queryHeading(long), `${'A'.repeat(14)}…${'G'.repeat(14)} (10,000 bp)`);
  assert.equal(queryHeading('GAATTC'), 'GAATTC');
});

test('track features carry a shortened copy of a long exact query', () => {
  const query = randomDna(10_000, 5);
  const hit = { index: 2, refName: 'chr1', start: 100, end: 10_100, strand: -1, matched: query };
  const f = featureData(hit, { query, count: 7 });
  assert.equal(f.uniqueId, 'genome-search-2');
  assert.deepEqual([f.refName, f.start, f.end, f.strand], ['chr1', 100, 10_100, -1]);
  assert.equal(f.name, 'Match 3');
  assert.equal(f.match_number, '3 of 7');
  assert.ok(f.matched_sequence.length < 120 && f.matched_sequence.endsWith('(10,000 bp)'));
  assert.ok(f.description.length < 80 && f.description.startsWith('− strand, '));
  assert.ok(JSON.stringify(f).length < 400, 'feature payload stays small');
});

test('ambiguity matches keep their exact genome bases in features', () => {
  const matched = 'ACGT'.repeat(25); // 100 bases, the ambiguity maximum
  const f = featureData({ index: 0, refName: 'c', start: 0, end: 100, strand: 1, matched }, { query: 'N'.repeat(100), count: 1 });
  assert.equal(FEATURE_SEQUENCE_MAX, 100);
  assert.equal(f.matched_sequence, matched);
});

test('a 10,000-base query is found once, across several chunk boundaries', async () => {
  const contig = randomDna(40_000, 77);
  const query = contig.slice(12_345, 22_345);
  for (const chunkSize of [1_000, 3_333, 1_000_000]) {
    const { status, hits } = await searchMemory({ c: contig, d: randomDna(15_000, 78) }, query, { chunkSize });
    assert.equal(status, 'complete');
    assert.deepEqual(hits.map(h => [h.refName, h.start, h.end, h.strand]), [['c', 12_345, 22_345, 1]], `chunk ${chunkSize}`);
  }
});
