export const DEFAULT_MAX_HITS = 10_000;
export const DEFAULT_CONCURRENCY = 2;

// Outcome of a search. Only 'complete' means every chunk was scanned and every
// match is listed.
export const STATUS = Object.freeze({
  COMPLETE: 'complete',
  LIMIT: 'limit',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
});

function abortError() {
  const e = new Error('Search cancelled');
  e.name = 'AbortError';
  return e;
}

// Runs scanChunk over planned chunks with bounded concurrency.
//   scanChunk(chunk) -> Promise<{ starts, strands, matched? }>
//   signal          AbortSignal; aborting stops dispatching new chunks and
//                   the result is reported as cancelled
//   onProgress      called after each chunk with running totals
// Chunks are dispatched strictly in order, so the chunks that have finished
// when work stops always include a contiguous prefix. Only that prefix is
// reported, which keeps every statement about coverage exact:
//   complete  all chunks scanned
//   limit     more than maxHits hits found; the first maxHits in genome order
//             are returned and `coveredThrough` is the last one reported
//   cancelled/failed  hits from the scanned prefix; `coveredThrough` is the
//             end of that prefix
export async function runSearch({
  chunks,
  scanChunk,
  queryLength,
  totalBases,
  maxHits = DEFAULT_MAX_HITS,
  concurrency = DEFAULT_CONCURRENCY,
  signal,
  onProgress = () => {},
}) {
  const results = new Array(chunks.length);
  const chunkBases = chunks.reduce((sum, c) => sum + c.bases, 0);
  // Contigs shorter than the query hold no chunks but are fully searched.
  let scannedBases = totalBases - chunkBases;
  let hitCount = 0;
  let next = 0;
  let stop = null;
  let error = null;

  async function lane() {
    while (stop === null && next < chunks.length) {
      if (signal?.aborted) {
        stop = STATUS.CANCELLED;
        break;
      }
      const chunk = chunks[next++];
      try {
        const result = await scanChunk(chunk);
        if (signal?.aborted) throw abortError();
        results[chunk.index] = result;
        hitCount += result.starts.length;
        scannedBases += chunk.bases;
        if (hitCount > maxHits && stop === null) stop = STATUS.LIMIT;
        onProgress({ scannedBases, totalBases, hits: Math.min(hitCount, maxHits), chunksDone: results.filter(Boolean).length, chunksTotal: chunks.length });
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') {
          stop ??= STATUS.CANCELLED;
        } else if (stop === null || stop === STATUS.LIMIT) {
          // A failure after the limit was reached does not hide the error.
          stop = STATUS.FAILED;
          error = e;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, chunks.length || 1)) }, lane));
  if (stop === null && signal?.aborted) stop = STATUS.CANCELLED;

  let prefix = 0;
  while (prefix < chunks.length && results[prefix]) prefix++;
  const hits = [];
  for (let i = 0; i < prefix; i++) {
    const { regionIndex, refName } = chunks[i];
    const { starts, strands, matched } = results[i];
    for (let j = 0; j < starts.length; j++) {
      hits.push({
        regionIndex,
        refName,
        start: starts[j],
        end: starts[j] + queryLength,
        strand: strands[j],
        ...(matched ? { matched: matched[j] } : {}),
      });
    }
  }

  let status = stop ?? STATUS.COMPLETE;
  if (hits.length > maxHits) {
    // The scanned prefix alone exceeds the limit, so the first maxHits hits
    // are exact even if later work failed or was cancelled.
    status = STATUS.LIMIT;
  } else if (status === STATUS.LIMIT) {
    // The limit was reached but an earlier chunk did not finish.
    status = error ? STATUS.FAILED : STATUS.CANCELLED;
  }
  let coveredThrough = null;
  if (status === STATUS.LIMIT) {
    hits.length = maxHits;
    const last = hits[maxHits - 1];
    coveredThrough = { refName: last.refName, position: last.start + 1 };
  } else if (status !== STATUS.COMPLETE) {
    coveredThrough = prefix > 0
      ? { refName: chunks[prefix - 1].refName, position: chunks[prefix - 1].end }
      : null;
  }
  return {
    status,
    hits,
    error: status === STATUS.FAILED ? error : null,
    coveredThrough,
    scannedBases: status === STATUS.COMPLETE ? totalBases : undefined,
  };
}
