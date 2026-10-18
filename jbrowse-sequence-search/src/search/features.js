import { shortSequence, strandLabel } from './format.js';

// Longest sequence copied into a track feature in full. Ambiguity queries
// (at most 100 bases) always fit, so their per-hit genome bases are kept
// exactly; long exact queries are shortened, because every feature on screen
// is passed between JBrowse's worker and the page. The list keeps the exact
// coordinates, and an exact match always reads as the query itself.
export const FEATURE_SEQUENCE_MAX = 100;

// Plain data for one results-track feature (SimpleFeature constructor input).
export function featureData(hit, results) {
  return {
    uniqueId: `genome-search-${hit.index}`,
    refName: hit.refName,
    start: hit.start,
    end: hit.end,
    strand: hit.strand,
    type: 'sequence_match',
    name: `Match ${hit.index + 1}`,
    description: `${strandLabel(hit.strand)} strand, ${shortSequence(results.query, 40)}`,
    matched_sequence: shortSequence(hit.matched, FEATURE_SEQUENCE_MAX),
    match_number: `${hit.index + 1} of ${results.count}`,
  };
}
