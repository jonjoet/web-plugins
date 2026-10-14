export const DEFAULT_CHUNK_SIZE = 1_000_000;

// Splits every region (contig) of an assembly into bounded chunks.
// Each chunk owns hits starting in [start, end) and fetches
// [start, min(end + queryLength - 1, region end)), so a hit that starts
// near the end of a chunk is still read completely, and no fetch ever
// extends past the end of its own contig.
// regions: [{ refName, start, end }] in assembly order (0-based, half-open).
export function planChunks(regions, { queryLength, chunkSize = DEFAULT_CHUNK_SIZE }) {
  if (!Number.isInteger(queryLength) || queryLength < 1) throw new Error('queryLength must be a positive integer');
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('chunkSize must be a positive integer');
  const chunks = [];
  regions.forEach((region, regionIndex) => {
    const { refName, start: regionStart, end: regionEnd } = region;
    if (!(Number.isInteger(regionStart) && Number.isInteger(regionEnd) && regionEnd >= regionStart)) {
      throw new Error(`Invalid region for ${refName}`);
    }
    const lastStart = regionEnd - queryLength;
    for (let start = regionStart; start <= lastStart; start += chunkSize) {
      const end = Math.min(start + chunkSize, lastStart + 1);
      chunks.push({
        index: chunks.length,
        regionIndex,
        refName,
        start,
        end,
        fetchStart: start,
        fetchEnd: Math.min(end + queryLength - 1, regionEnd),
        // Bases of the contig accounted for by this chunk, for progress.
        bases: (end >= lastStart + 1 ? regionEnd : end) - start,
      });
    }
  });
  return chunks;
}

export function totalBases(regions) {
  return regions.reduce((sum, r) => sum + (r.end - r.start), 0);
}
