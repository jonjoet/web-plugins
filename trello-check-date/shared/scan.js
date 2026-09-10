import { ApiError } from './trello-api.js';
import { cardIsActive, compareDue, indexLists, indexRecords, normalizeBoard,
  requireShape, validId, validateBoard, validateCard } from './overdue.js';

// Never label the current single-response routes complete. The live shape probe
// established item fields, not endpoint paging/limit or exhaustion semantics.
const pendingCoverage = () => ['collection-completeness-unverified'];

async function fallbackCards(api, boardId, lists, signal) {
  const cards = indexRecords(await api.metadata(boardId, signal));
  signal?.throwIfAborted();
  const listIndex = indexLists(lists);
  for (const card of cards.values()) validateCard(card, boardId);
  const checklists = indexRecords(await api.checklists(boardId, signal));
  signal?.throwIfAborted();
  const joined = new Map([...cards].map(([id, card]) => [id, { ...card, checklists: [] }]));
  // These results exist only for this read. Multiple checklists may reference the
  // same missing card, which needs just one scheduled, retry-bounded lookup.
  const excluded = new Set();
  for (const checklist of checklists.values()) {
    requireShape(validId(checklist.idCard));
    const card = joined.get(checklist.idCard);
    if (card) { card.checklists.push(checklist); continue; }
    if (excluded.has(checklist.idCard)) continue;
    const missing = await api.card(checklist.idCard, signal);
    signal?.throwIfAborted();
    requireShape(missing?.id === checklist.idCard);
    if (cardIsActive(missing, boardId, listIndex)) {
      // Finding one missing open card does not repair the card collection.
      throw new ApiError('inconsistent');
    }
    excluded.add(checklist.idCard);
  }
  return [...joined.values()];
}

export async function readBoard(api, board, { signal, now, strategy = 'nested' }) {
  validateBoard(board);
  requireShape(Number.isFinite(now) && ['nested', 'fallback'].includes(strategy));
  signal?.throwIfAborted();
  if (board.closed) return { rows: [], issues: [] };
  const lists = await api.lists(board.id, signal);
  signal?.throwIfAborted();
  indexLists(lists);
  const cards = strategy === 'fallback'
    ? await fallbackCards(api, board.id, lists, signal)
    : await api.scanCards(board.id, signal);
  signal?.throwIfAborted();
  return { rows: normalizeBoard({ board, cards, lists }, now), issues: pendingCoverage() };
}

// One scanner per authorized API instance. The board-list cache is in memory;
// refresh/close invalidate pending scans even if a transport ignores its signal.
export function createScanner(api, { clock = Date.now } = {}) {
  let boardCache;
  let active;
  let generation = 0;
  const cancel = () => { generation++; active?.abort(); };
  async function scan({ signal, fullRefresh = false, boardId, strategy = 'nested',
    onProgress = () => {} } = {}) {
    cancel();
    const ownGeneration = generation;
    active = new AbortController();
    const controller = active;
    const workSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const check = () => {
      workSignal.throwIfAborted();
      if (ownGeneration !== generation) throw new DOMException('Scan replaced', 'AbortError');
    };
    check();
    requireShape(boardId === undefined || validId(boardId));
    requireShape(['nested', 'fallback'].includes(strategy));
    const startedAt = clock();
    requireShape(Number.isFinite(startedAt));
    if (fullRefresh) boardCache = undefined;
    try {
      if (!boardCache) {
        const boards = indexRecords(await api.boards(workSignal));
        check();
        for (const board of boards.values()) validateBoard(board);
        boardCache = [...boards.values()].filter(board => !board.closed)
          .map(board => ({ ...board }));
      }
      const boards = boardId === undefined ? boardCache : boardCache.filter(b => b.id === boardId);
      if (boardId !== undefined && boards.length === 0) throw new ApiError('inconsistent');
      const rows = [];
      const observedItemIds = new Set();
      // Reserved for certified collection coverage. Successful observations
      // currently enter unverifiedBoardIds; the view must count those as read.
      const completedBoardIds = [];
      const failedBoards = [];
      const unverifiedBoardIds = [];
      let checkedBoards = 0;
      onProgress({ checkedBoards, totalBoards: boards.length });
      check();
      for (const board of boards) {
        try {
          const result = await readBoard(api, board,
            { signal: workSignal, now: startedAt, strategy });
          check();
          // A card can move between board reads. Do not count the same item
          // twice or silently choose which board currently owns it.
          if (result.rows.some(row => observedItemIds.has(row.itemId))) {
            throw new ApiError('inconsistent');
          }
          for (const row of result.rows) observedItemIds.add(row.itemId);
          rows.push(...result.rows);
          if (result.issues.length) unverifiedBoardIds.push(board.id);
          else completedBoardIds.push(board.id);
        } catch (error) {
          check();
          if (error.code === 'unauthorized' || error.code === 'setup') throw error;
          failedBoards.push({ boardId: board.id,
            code: error instanceof ApiError ? error.code : 'shape',
            status: error instanceof ApiError ? error.status : 0 });
        }
        checkedBoards++;
        onProgress({ checkedBoards, totalBoards: boards.length });
        check();
      }
      const finishedAt = clock();
      requireShape(Number.isFinite(finishedAt));
      return { rows: rows.sort(compareDue), completedBoardIds, failedBoards,
        unverifiedBoardIds, totalBoards: boards.length, startedAt, finishedAt,
        // Board enumeration itself also lacks a verified limit contract. Even
        // an empty list cannot certify an account-wide empty result yet.
        complete: false, issues: pendingCoverage() };
    } catch (error) {
      check();
      if (error.code === 'unauthorized' || error.code === 'setup') {
        boardCache = undefined;
        controller.abort();
      }
      throw error;
    }
  }
  return { scan, cancel };
}
