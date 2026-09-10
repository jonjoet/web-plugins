import { ApiError } from './trello-api.js';

const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const validRecord = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateBoards(boards) {
  if (!Array.isArray(boards) || boards.some(board => !validRecord(board)
    || !validId(board.id) || typeof board.name !== 'string'
    || typeof board.closed !== 'boolean') || new Set(boards.map(b => b.id)).size !== boards.length) {
    throw new ApiError('shape');
  }
  return boards.filter(board => !board.closed);
}

export function inspectCards(cards) {
  if (!Array.isArray(cards)) throw new ApiError('shape');
  const result = { cards: cards.length, checklists: 0, items: 0, datedItems: 0,
    missingChecklistArrays: 0, missingItemArrays: 0, invalidRecords: 0 };
  const ids = new Set();
  for (const card of cards) {
    if (!validRecord(card) || !validId(card.id) || typeof card.name !== 'string'
      || typeof card.url !== 'string' || ids.has(card.id)) {
      result.invalidRecords++; continue;
    }
    ids.add(card.id);
    if (!Array.isArray(card.checklists)) { result.missingChecklistArrays++; continue; }
    const checklistIds = new Set();
    for (const checklist of card.checklists) {
      result.checklists++;
      if (!validRecord(checklist) || !validId(checklist.id)
        || typeof checklist.name !== 'string' || checklistIds.has(checklist.id)) {
        result.invalidRecords++; continue;
      }
      checklistIds.add(checklist.id);
      if (!Array.isArray(checklist.checkItems)) { result.missingItemArrays++; continue; }
      const itemIds = new Set();
      for (const item of checklist.checkItems) {
        result.items++;
        if (!validRecord(item) || !validId(item.id) || typeof item.name !== 'string'
          || !['complete', 'incomplete'].includes(item.state)
          || !(item.due === null || (typeof item.due === 'string'
            && Number.isFinite(Date.parse(item.due)))) || itemIds.has(item.id)) {
          result.invalidRecords++; continue;
        }
        itemIds.add(item.id);
        if (item.due !== null) result.datedItems++;
      }
    }
  }
  return { ...result, shapeValid: result.invalidRecords === 0
    && result.missingChecklistArrays === 0 && result.missingItemArrays === 0,
  itemFieldsObserved: result.items > 0 };
}

export function inspectArchives(cards, lists, checklists) {
  if (![cards, lists, checklists].every(Array.isArray)) throw new ApiError('shape');
  const listMap = new Map();
  for (const list of lists) {
    if (!validRecord(list) || !validId(list.id) || typeof list.closed !== 'boolean'
      || listMap.has(list.id)) throw new ApiError('shape');
    listMap.set(list.id, list.closed);
  }
  const cardIds = new Set();
  let openCardsInArchivedLists = 0;
  let unresolvedLists = 0;
  for (const card of cards) {
    if (!validRecord(card) || !validId(card.id) || !validId(card.idList)
      || typeof card.closed !== 'boolean' || cardIds.has(card.id)) throw new ApiError('shape');
    cardIds.add(card.id);
    if (!listMap.has(card.idList)) unresolvedLists++;
    else if (!card.closed && listMap.get(card.idList)) openCardsInArchivedLists++;
  }
  const unmatched = new Set();
  for (const checklist of checklists) {
    if (!validRecord(checklist) || !validId(checklist.idCard)) throw new ApiError('shape');
    if (!cardIds.has(checklist.idCard)) unmatched.add(checklist.idCard);
  }
  return { lists: lists.length, metadataCards: cards.length, fallbackChecklists: checklists.length,
    openCardsInArchivedLists, unresolvedLists, unmatchedFallbackCards: unmatched.size,
    joinClassification: 'pending-targeted-lookup-verification' };
}

// This is a diagnostic, not an overdue scan. Never infer completeness from size.
export async function runProbe(api, boardId, signal, onProgress = () => {}) {
  const report = { kind: 'trello-integration-shape-probe', version: 1,
    collectionCompleteness: 'unverified', authorizationPersistence: 'manual-reopen-check-required' };
  async function check(label, task) {
    signal.throwIfAborted();
    onProgress(label);
    try { report[label] = await task(); }
    catch (error) {
      signal.throwIfAborted();
      if (error.code === 'unauthorized' || error.code === 'setup') throw error;
      report[label] = { error: error instanceof ApiError ? error.code : 'shape',
        status: error instanceof ApiError ? error.status : 0 };
    }
  }
  await check('nameProjection', async () => inspectCards(await api.projectedCards(boardId, signal)));
  await check('defaultProjection', async () => inspectCards(await api.defaultCards(boardId, signal)));
  await check('archivesAndFallback', async () => {
    const cards = await api.metadata(boardId, signal);
    const lists = await api.lists(boardId, signal);
    const checklists = await api.checklists(boardId, signal);
    return inspectArchives(cards, lists, checklists);
  });
  signal.throwIfAborted();
  return report;
}
