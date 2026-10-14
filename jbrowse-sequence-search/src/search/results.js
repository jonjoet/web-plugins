import { BOTH, FORWARD, REVERSE } from './scan.js';

// A result set is stored once, in the results track's adapter configuration,
// and both the track and the results list decode that same object.
// Hits are packed into one string to keep the frequently serialized session
// small: "<refIndex>.<start>.<strand>[.<matchedIndex>]" in base 36, joined by
// commas, in genome order. Strand is "+", "-" or "b" (both strands).
export const FORMAT_VERSION = 1;

const STRAND_CODE = { [FORWARD]: '+', [REVERSE]: '-', [BOTH]: 'b' };
const CODE_STRAND = { '+': FORWARD, '-': REVERSE, b: BOTH };

export function encodeResults({ search, outcome, createdAt }) {
  const refNames = [];
  const refIndex = new Map();
  const seqs = [];
  const seqIndex = new Map();
  const packed = outcome.hits.map(hit => {
    if (!refIndex.has(hit.refName)) {
      refIndex.set(hit.refName, refNames.length);
      refNames.push(hit.refName);
    }
    let entry = `${refIndex.get(hit.refName).toString(36)}.${hit.start.toString(36)}.${STRAND_CODE[hit.strand]}`;
    if (search.ambiguous) {
      if (!seqIndex.has(hit.matched)) {
        seqIndex.set(hit.matched, seqs.length);
        seqs.push(hit.matched);
      }
      entry += `.${seqIndex.get(hit.matched).toString(36)}`;
    }
    return entry;
  });
  return {
    formatVersion: FORMAT_VERSION,
    assemblyName: search.assemblyName,
    query: search.query,
    strandMode: search.strandMode,
    ambiguous: search.ambiguous,
    allowAmbiguity: search.allowAmbiguity,
    palindromic: search.palindromic,
    regionCount: search.regionCount,
    totalBases: search.totalBases,
    maxHits: search.maxHits,
    status: outcome.status,
    error: outcome.error ? String(outcome.error.message || outcome.error) : null,
    coveredThrough: outcome.coveredThrough,
    createdAt,
    count: outcome.hits.length,
    refNames,
    seqs,
    hits: packed.join(','),
  };
}

export function decodeResults(stored) {
  if (!stored || stored.formatVersion !== FORMAT_VERSION) {
    throw new Error('These search results were saved in an unsupported format. Run the search again.');
  }
  const m = stored.query.length;
  const hits = stored.hits === '' ? [] : stored.hits.split(',').map((entry, index) => {
    const [r, s, d, q] = entry.split('.');
    const refName = stored.refNames[parseInt(r, 36)];
    const start = parseInt(s, 36);
    const strand = CODE_STRAND[d];
    if (refName === undefined || !Number.isFinite(start) || strand === undefined) {
      throw new Error('Saved search results are damaged. Run the search again.');
    }
    return {
      index,
      refName,
      start,
      end: start + m,
      strand,
      // Exact queries read as the query on the strand of the match.
      matched: q === undefined ? stored.query : stored.seqs[parseInt(q, 36)],
    };
  });
  if (hits.length !== stored.count) throw new Error('Saved search results are incomplete. Run the search again.');
  return { ...stored, hits };
}

// Index of the hit to select when stepping by delta (-1 previous, +1 next).
// Stops at the ends rather than wrapping. With no selection, "next" selects
// the first hit and "previous" the last.
export function stepIndex(current, count, delta) {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + delta));
}
