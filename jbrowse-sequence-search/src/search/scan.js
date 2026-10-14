import { isConcrete, patternSource, reverseComplement } from './iupac.js';

// Strand codes used throughout: 1 forward (+), -1 reverse (−), 0 both strands
// (the same interval matches on both strands, e.g. a palindromic site).
export const FORWARD = 1;
export const REVERSE = -1;
export const BOTH = 0;

export const STRAND_MODES = Object.freeze(['both', 'forward', 'reverse']);

// Positions (relative to text) where pattern starts, for starts in
// [from, to), at most `limit` of them. Overlapping occurrences are all
// reported.
function findAll(text, pattern, from, to, limit) {
  const found = [];
  if (to <= from) return found;
  if (isConcrete(pattern)) {
    let i = text.indexOf(pattern, from);
    while (i !== -1 && i < to && found.length < limit) {
      found.push(i);
      i = text.indexOf(pattern, i + 1);
    }
    return found;
  }
  // Fixed-length lookahead: zero-width, so every start position is tested.
  const re = new RegExp(`(?=${patternSource(pattern)})`, 'g');
  re.lastIndex = from;
  let m;
  while (found.length < limit && (m = re.exec(text)) !== null && m.index < to) {
    found.push(m.index);
    re.lastIndex = m.index + 1;
  }
  return found;
}

// Scans one fetched stretch of a single contig.
//   text       residues as returned by the sequence adapter (any case)
//   textStart  0-based genome coordinate of text[0]
//   query      validated uppercase query (parseQuery().sequence)
//   strandMode 'both' | 'forward' | 'reverse'
//   accept     [acceptStart, acceptEnd): only hits whose 0-based start falls
//              here are reported. Chunks partition each contig by hit start,
//              so a hit is reported by exactly one chunk.
//   withMatched include the genome bases read on the hit strand (used when
//              the query has ambiguity codes, since they can differ per hit)
//   limit      return at most this many hits: the first ones by start. The
//              search needs only maxHits + 1 per chunk to detect the limit.
// Returns { starts, strands, matched? } sorted by start, one hit per start.
export function scanText(text, textStart, query, strandMode, acceptStart, acceptEnd, withMatched = false, limit = Infinity) {
  if (!STRAND_MODES.includes(strandMode)) throw new Error(`Unknown strand mode ${strandMode}`);
  const upper = text.toUpperCase();
  const m = query.length;
  const from = Math.max(0, acceptStart - textStart);
  const to = Math.min(upper.length - m + 1, acceptEnd - textStart);
  // The first `limit` merged hits come from the first `limit` of each strand.
  const forward = strandMode === 'reverse' ? [] : findAll(upper, query, from, to, limit);
  const reverse = strandMode === 'forward' ? [] : findAll(upper, reverseComplement(query), from, to, limit);

  const starts = [];
  const strands = [];
  const matched = withMatched ? [] : undefined;
  let f = 0;
  let r = 0;
  while ((f < forward.length || r < reverse.length) && starts.length < limit) {
    let pos;
    let strand;
    if (r >= reverse.length || (f < forward.length && forward[f] < reverse[r])) {
      pos = forward[f++];
      strand = FORWARD;
    } else if (f >= forward.length || reverse[r] < forward[f]) {
      pos = reverse[r++];
      strand = REVERSE;
    } else {
      pos = forward[f++];
      r++;
      strand = BOTH;
    }
    starts.push(textStart + pos);
    strands.push(strand);
    if (matched) {
      const bases = upper.slice(pos, pos + m);
      matched.push(strand === REVERSE ? reverseComplement(bases) : bases);
    }
  }
  return matched ? { starts, strands, matched } : { starts, strands };
}
