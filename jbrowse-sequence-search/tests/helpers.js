import { matchesPattern, reverseComplement } from '../src/search/iupac.js';
import { planChunks, totalBases } from '../src/search/chunks.js';
import { runSearch } from '../src/search/run.js';
import { scanText } from '../src/search/scan.js';

// Synthetic assembly: contigs in assembly order, with soft-masked (lowercase)
// stretches and an N gap.
export const CONTIGS = {
  chrA: 'GAATTCaaccGGTACCttttGAATTCTTnnnnAAAAAAcgtGAATT',
  chrB: 'cgaattcGGATCCAAAAAAGGATCCatGTTAACnGAATTC',
  chrC: 'AC',
  chrD: 'TTTTTGAATTC',
};

export function regionsOf(contigs) {
  return Object.entries(contigs).map(([refName, seq]) => ({ refName, start: 0, end: seq.length }));
}

// Reference implementation: test every position of every contig.
export function bruteForce(contigs, query, strandMode = 'both') {
  const rc = reverseComplement(query);
  const hits = [];
  for (const [refName, seq] of Object.entries(contigs)) {
    const upper = seq.toUpperCase();
    for (let p = 0; p + query.length <= upper.length; p++) {
      const bases = upper.slice(p, p + query.length);
      const f = strandMode !== 'reverse' && matchesPattern(bases, query);
      const r = strandMode !== 'forward' && matchesPattern(bases, rc);
      if (f || r) {
        hits.push({ refName, start: p, end: p + query.length, strand: f && r ? 0 : f ? 1 : -1 });
      }
    }
  }
  return hits;
}

export function memoryScanner(contigs, query, strandMode, withMatched = false, limit = Infinity) {
  return async chunk => scanText(
    contigs[chunk.refName].slice(chunk.fetchStart, chunk.fetchEnd),
    chunk.fetchStart, query, strandMode, chunk.start, chunk.end, withMatched, limit);
}

export async function searchMemory(contigs, query, { strandMode = 'both', chunkSize, maxHits = 10_000, concurrency, signal, withMatched, chunkLimit = maxHits + 1 } = {}) {
  const regions = regionsOf(contigs);
  return runSearch({
    chunks: planChunks(regions, { queryLength: query.length, chunkSize }),
    scanChunk: memoryScanner(contigs, query, strandMode, withMatched, chunkLimit),
    queryLength: query.length,
    totalBases: totalBases(regions),
    maxHits,
    concurrency,
    signal,
  });
}

export function strip(hits) {
  return hits.map(({ refName, start, end, strand }) => ({ refName, start, end, strand }));
}

// Deterministic pseudo-random DNA.
export function randomDna(length, seed) {
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out += 'ACGT'[x & 3];
  }
  return out;
}
