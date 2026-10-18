import { formatBases, formatNumber, shortSequence } from './format.js';

const STRANDS = {
  both: 'both strands',
  forward: 'the forward (+) strand only',
  reverse: 'the reverse (−) strand only',
};

export function plural(n, word) {
  return `${formatNumber(n)} ${word}${n === 1 ? '' : 'es'}`;
}

// "all 25 sequences of hg38 (3.10 Gb), both strands", or
// "the 1 sequence of …" for a single-sequence assembly.
export function scopeText({ assemblyName, regionCount, totalBases, strandMode }) {
  const sequences = regionCount === 1 ? 'the 1 sequence' : `all ${formatNumber(regionCount)} sequences`;
  return `${sequences} of ${assemblyName} (${formatBases(totalBases)}), ${STRANDS[strandMode]}`;
}

function coverageText(r) {
  if (!r.coveredThrough) return 'It stopped before any part of the genome was fully searched.';
  const { refName, position } = r.coveredThrough;
  return `Matches starting up to ${refName}:${formatNumber(position)} are listed; later positions were not searched.`;
}

// The query as shown in a message heading: long queries are shortened.
export function queryHeading(query) {
  return shortSequence(query, 40);
}

// One message that states exactly what was searched and whether the list is
// complete.
export function outcomeMessage(r) {
  const scope = scopeText(r);
  switch (r.status) {
    case 'complete':
      return r.count === 0
        ? { severity: 'info', text: `No matches. Searched ${scope}.` }
        : { severity: 'success', text: `Found ${plural(r.count, 'match')}. Searched ${scope}.` };
    case 'limit':
      return {
        severity: 'warning',
        text: `Incomplete: stopped at the limit of ${formatNumber(r.maxHits)} matches. The first ${formatNumber(r.count)} in genome order are listed, through ${r.coveredThrough.refName}:${formatNumber(r.coveredThrough.position)}; the rest of ${r.assemblyName} was not searched. Use a longer sequence to narrow the search.`,
      };
    case 'cancelled':
      return { severity: 'warning', text: `Incomplete: search stopped. ${plural(r.count, 'match')} found before stopping. ${coverageText(r)}` };
    default:
      return { severity: 'error', text: `Incomplete: the search failed (${r.error}). ${plural(r.count, 'match')} found before the failure. ${coverageText(r)}` };
  }
}
