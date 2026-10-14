import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks } from '../src/search/chunks.js';
import { runSearch } from '../src/search/run.js';
import { createCoordinator } from '../src/search/coordinator.js';
import { pickAssembly } from '../src/search/assembly.js';
import { CONTIGS, searchMemory } from './helpers.js';

const regions = [
  { refName: 'c1', start: 0, end: 100 },
  { refName: 'c2', start: 0, end: 100 },
];
const chunks = planChunks(regions, { queryLength: 1, chunkSize: 25 }); // 8 chunks
const oneHitPerChunk = chunk => ({ starts: [chunk.start], strands: [1] });
const tick = () => new Promise(resolve => setTimeout(resolve, 1));

test('result limit returns the first hits in genome order and says so', async () => {
  const contigs = { a: 'A'.repeat(50), b: 'A'.repeat(50) };
  const result = await searchMemory(contigs, 'A', { strandMode: 'forward', chunkSize: 7, maxHits: 60, concurrency: 3 });
  assert.equal(result.status, 'limit');
  assert.equal(result.hits.length, 60);
  assert.deepEqual(result.hits.slice(48, 52).map(h => [h.refName, h.start]), [['a', 48], ['a', 49], ['b', 0], ['b', 1]]);
  assert.deepEqual(result.coveredThrough, { refName: 'b', position: 10 });
});

test('exactly maxHits matches is still complete', async () => {
  const result = await searchMemory({ a: 'A'.repeat(10) }, 'A', { strandMode: 'forward', maxHits: 10 });
  assert.equal(result.status, 'complete');
  assert.equal(result.hits.length, 10);
});

test('cancellation stops dispatching chunks and keeps only the scanned prefix', async () => {
  const controller = new AbortController();
  const dispatched = [];
  const result = await runSearch({
    chunks, queryLength: 1, totalBases: 200, concurrency: 2, signal: controller.signal,
    scanChunk: async chunk => {
      dispatched.push(chunk.index);
      if (chunk.index === 2) controller.abort();
      await tick();
      return oneHitPerChunk(chunk);
    },
  });
  assert.equal(result.status, 'cancelled');
  // Chunks 0..3 may have started (two lanes); nothing after the abort.
  assert.ok(Math.max(...dispatched) <= 3, `dispatched ${dispatched}`);
  // Chunks 1 and 2 were in flight at the abort; results arriving after it are
  // discarded, so only chunk 0 counts.
  assert.deepEqual(result.hits.map(h => h.start), [0]);
  assert.deepEqual(result.coveredThrough, { refName: 'c1', position: 25 });
});

test('cancel before any chunk finishes reports nothing searched', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runSearch({ chunks, queryLength: 1, totalBases: 200, signal: controller.signal, scanChunk: async () => { calls++; } });
  assert.equal(result.status, 'cancelled');
  assert.equal(calls, 0);
  assert.equal(result.coveredThrough, null);
});

test('a failing chunk stops the search and is reported as a failure', async () => {
  const result = await runSearch({
    chunks, queryLength: 1, totalBases: 200, concurrency: 1,
    scanChunk: async chunk => {
      if (chunk.index === 5) throw new Error('fetch failed');
      return oneHitPerChunk(chunk);
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.message, 'fetch failed');
  assert.equal(result.hits.length, 5);
  assert.deepEqual(result.coveredThrough, { refName: 'c2', position: 25 });
});

test('concurrency is bounded', async () => {
  let active = 0;
  let peak = 0;
  await runSearch({
    chunks, queryLength: 1, totalBases: 200, concurrency: 3,
    scanChunk: async chunk => {
      active++; peak = Math.max(peak, active);
      await tick();
      active--;
      return oneHitPerChunk(chunk);
    },
  });
  assert.equal(peak, 3);
});

test('progress reaches the total for a complete search', async () => {
  const seen = [];
  const r = await runSearch({
    chunks: planChunks([{ refName: 'a', start: 0, end: 1000 }, { refName: 'c', start: 0, end: 1 }], { queryLength: 3, chunkSize: 100 }),
    queryLength: 3, totalBases: 1001,
    scanChunk: async () => ({ starts: [], strands: [] }),
    onProgress: p => seen.push(p.scannedBases),
  });
  assert.equal(r.status, 'complete');
  assert.equal(seen.at(-1), 1001);
});

test('a replacement search aborts the previous one and stale results are flagged', async () => {
  const coordinator = createCoordinator();
  const slow = coordinator.start(signal => searchMemory(CONTIGS, 'GAATTC', { chunkSize: 2, concurrency: 1, signal }));
  const fast = coordinator.start(signal => searchMemory(CONTIGS, 'AAA', { signal }));
  const [first, second] = await Promise.all([slow.promise, fast.promise]);
  assert.equal(slow.ticket.controller.signal.aborted, true);
  assert.equal(first.stale, true);
  assert.equal(first.result.status, 'cancelled');
  assert.equal(second.stale, false);
  assert.equal(second.result.status, 'complete');
  assert.equal(coordinator.running, false);
});

test('a search keeps running when no replacement starts', async () => {
  const coordinator = createCoordinator();
  const only = coordinator.start(signal => searchMemory(CONTIGS, 'GAATTC', { signal }));
  assert.equal(coordinator.running, true);
  const settled = await only.promise;
  assert.equal(settled.stale, false);
  assert.equal(settled.result.hits.length, 5);
});

test('default assembly follows the originating view', () => {
  assert.equal(pickAssembly(['hg38', 'mm39'], ['mm39', 'hg38']), 'mm39');
  assert.equal(pickAssembly(['hg38', 'mm39'], [undefined, 'hg38']), 'hg38');
  assert.equal(pickAssembly(['hg38', 'mm39'], ['volvox']), 'hg38');
  assert.equal(pickAssembly([], ['x']), undefined);
});
