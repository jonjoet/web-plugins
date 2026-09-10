import { ApiError } from './trello-api.js';

export const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function requireShape(condition) {
  if (!condition) throw new ApiError('shape');
}

export function indexRecords(values) {
  requireShape(Array.isArray(values));
  const index = new Map();
  for (const value of values) {
    requireShape(record(value) && validId(value.id) && !index.has(value.id));
    index.set(value.id, value);
  }
  return index;
}

export function validateBoard(board) {
  requireShape(record(board) && validId(board.id)
    && typeof board.name === 'string' && typeof board.closed === 'boolean');
}

export function indexLists(lists) {
  const index = indexRecords(lists);
  for (const list of index.values()) requireShape(typeof list.closed === 'boolean');
  return index;
}

// Only normal Trello card destinations can become external links in the view.
export function cardUrl(value) {
  requireShape(typeof value === 'string');
  let url;
  try { url = new URL(value); } catch { throw new ApiError('shape'); }
  requireShape(url.origin === 'https://trello.com' && !url.username && !url.password
    && /^\/c\/[a-z\d]+(?:\/|$)/i.test(url.pathname));
  return url.href;
}

export function validateCard(card, boardId) {
  requireShape(record(card) && validId(card.id) && validId(card.idBoard)
    && validId(card.idList) && typeof card.closed === 'boolean');
  if (card.idBoard !== boardId) throw new ApiError('inconsistent');
}

export function cardIsActive(card, boardId, lists) {
  validateCard(card, boardId);
  if (card.closed) return false;
  const list = lists.get(card.idList);
  if (!list) throw new ApiError('inconsistent');
  return !list.closed;
}

// Reject missing values, ambiguous local dates and impossible calendar dates.
// Trello's due values are ISO instants; null is the ordinary no-due-date case.
export function dueTimestamp(value) {
  if (value === null) return null;
  requireShape(typeof value === 'string');
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  requireShape(parts);
  const [, y, m, d, h, minute, second] = parts.map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  requireShape(m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]
    && h < 24 && minute < 60 && second < 60);
  const timestamp = Date.parse(value);
  requireShape(Number.isFinite(timestamp));
  return timestamp;
}

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function compareDue(a, b) {
  return (a.due === null) - (b.due === null) || a.due - b.due || compareId(a.boardId, b.boardId)
    || compareId(a.cardId, b.cardId) || compareId(a.itemId, b.itemId);
}

// Rows contain active observations and elapsed time frozen at scan start.
export function filterItems(rows, mode = 'overdue') {
  requireShape(['all', 'dated', 'overdue'].includes(mode));
  return rows.filter(row => mode === 'all' || (row.due !== null
    && (mode === 'dated' || row.elapsedMs > 0)));
}

export function daysOverdue(elapsedMs) {
  requireShape(Number.isFinite(elapsedMs) && elapsedMs > 0);
  return elapsedMs < 86400000 ? '<1' : String(Math.floor(elapsedMs / 86400000));
}

// Validates a supplied observation; it makes no claim about API completeness.
export function normalizeBoard({ board, cards, lists }, now) {
  validateBoard(board);
  requireShape(Number.isFinite(now));
  if (board.closed) return [];
  const listIndex = indexLists(lists);
  const cardIndex = indexRecords(cards);
  const checklistIds = new Set();
  const itemIds = new Set();
  const rows = [];
  for (const card of cardIndex.values()) {
    if (!cardIsActive(card, board.id, listIndex)) continue;
    requireShape(typeof card.name === 'string');
    const url = cardUrl(card.url);
    for (const checklist of indexRecords(card.checklists).values()) {
      requireShape(typeof checklist.name === 'string' && !checklistIds.has(checklist.id));
      checklistIds.add(checklist.id);
      for (const item of indexRecords(checklist.checkItems).values()) {
        requireShape(typeof item.name === 'string' && ['complete', 'incomplete'].includes(item.state)
          && !itemIds.has(item.id));
        itemIds.add(item.id);
        const due = dueTimestamp(item.due);
        if (item.state !== 'incomplete') continue;
        rows.push({ itemId: item.id, itemName: item.name,
          checklistId: checklist.id, checklistName: checklist.name,
          cardId: card.id, cardName: card.name, cardUrl: url,
          boardId: board.id, boardName: board.name, due, elapsedMs: due === null ? null : now - due });
      }
    }
  }
  return rows.sort(compareDue);
}
