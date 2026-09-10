import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../shared/trello-api.js';
import { cardUrl, daysOverdue, dueTimestamp, normalizeBoard } from '../shared/overdue.js';
import { createScanner, readBoard } from '../shared/scan.js';
import { scanSummary } from '../shared/ui.js';

const id = n => n.toString(16).padStart(24, '0');
const now = Date.parse('2026-09-10T12:00:00Z');
const board = (n = 1) => ({ id: id(n), name: `Board ${n}`, closed: false });
const item = (n = 5, changes = {}) => ({ id: id(n), name: 'Item',
  state: 'incomplete', due: '2026-09-09T12:00:00Z', ...changes });
const card = (changes = {}) => ({ id: id(3), name: 'Card',
  url: 'https://trello.com/c/fixture/card', closed: false, idBoard: id(1), idList: id(2),
  checklists: [{ id: id(4), name: 'Checklist', checkItems: [item()] }], ...changes });
const data = () => ({ board: board(), lists: [{ id: id(2), closed: false }], cards: [card()] });
const signal = () => new AbortController().signal;
function fixture() {
  const calls = [];
  const api = {
    boards: async () => { calls.push('boards'); return [board()]; },
    lists: async () => { calls.push('lists'); return data().lists; },
    scanCards: async () => { calls.push('cards'); return [card()]; },
    metadata: async () => [card()],
    checklists: async () => [{ ...card().checklists[0], idCard: id(3) }],
    card: async () => { throw new Error('Unexpected targeted lookup'); },
  };
  return { api, calls };
}

test('only incomplete past-due items qualify; all assignees and card dueComplete are irrelevant', () => {
  const d = data();
  d.cards[0].dueComplete = true;
  d.cards[0].due = '2030-01-01T00:00:00Z';
  d.cards[0].checklists[0].checkItems = [item(10), item(11, { idMember: id(12) }),
    item(13, { due: null }), item(14, { state: 'complete' }),
    item(15, { due: '2026-09-10T12:00:00Z' }), item(16, { due: '2026-09-11T00:00:00Z' })];
  const rows = normalizeBoard(d, now);
  assert.deepEqual(rows.map(r => r.itemId), [id(10), id(11)]);
  assert.equal(rows[0].elapsedMs, 86400000);
  assert.equal(rows[0].checklistName, 'Checklist');
  assert.equal(rows[0].boardName, 'Board 1');
});

test('instant parsing handles offsets, DST and calendar validity; days use elapsed time', () => {
  assert.equal(dueTimestamp('2026-03-08T01:30:00-05:00'), Date.parse('2026-03-08T06:30:00Z'));
  assert.equal(dueTimestamp('2026-03-08T03:30:00-04:00')
    - dueTimestamp('2026-03-08T01:30:00-05:00'), 3600000);
  assert.equal(daysOverdue(1), '<1');
  assert.equal(daysOverdue(23 * 3600000), '<1');
  assert.equal(daysOverdue(49 * 3600000), '2');
  assert.equal(dueTimestamp('2028-02-29T00:00:00Z'), Date.parse('2028-02-29T00:00:00Z'));
  for (const value of [undefined, '', 'invalid', '2026-02-30T00:00:00Z',
    '2026-02-29T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00', 0]) assert.throws(() => dueTimestamp(value), { code: 'shape' });
  const d = data();
  d.cards[0].checklists[0].checkItems = [item(10, { due: '2026-09-09T08:00:00-04:00' }), item(9)];
  assert.deepEqual(normalizeBoard(d, now).map(r => r.itemId), [id(9), id(10)]);
});

test('positive archive states exclude boards/cards/lists; missing or moved parents fail', () => {
  for (const change of [d => { d.board.closed = true; },
    d => { d.cards[0].closed = true; }, d => { d.lists[0].closed = true; }]) {
    const d = data(); change(d); assert.deepEqual(normalizeBoard(d, now), []);
  }
  for (const change of [d => { d.lists = []; }, d => { d.cards[0].idBoard = id(100); }]) {
    const d = data(); change(d); assert.throws(() => normalizeBoard(d, now), { code: 'inconsistent' });
  }
  const d = data(); d.lists[0].closed = 'false';
  assert.throws(() => normalizeBoard(d, now), { code: 'shape' });
});

test('missing collections, invalid fields and duplicate identities fail, even on nonmatching items', () => {
  for (const change of [d => { delete d.cards[0].checklists; },
    d => { delete d.cards[0].checklists[0].checkItems; },
    d => { d.cards[0].checklists[0].checkItems[0].state = 'unknown'; },
    d => { d.cards[0].checklists[0].checkItems[0].due = 'bad'; },
    d => { d.cards.push(card()); }, d => { d.lists.push({ ...d.lists[0] }); },
    d => { d.cards[0].checklists[0].checkItems.push(item()); },
    d => { d.cards.push(card({ id: id(6) })); }]) {
    const d = data(); change(d); assert.throws(() => normalizeBoard(d, now), { code: 'shape' });
  }
  const d = data(); d.cards[0].checklists[0].checkItems[0] = item(5, { state: 'complete', due: 'bad' });
  assert.throws(() => normalizeBoard(d, now), { code: 'shape' });
});

test('card links require a Trello HTTPS card destination; names remain literal text', () => {
  for (const url of ['javascript:alert(1)', 'https://trello.com.evil.test/c/a',
    'https://evil.test/c/a', 'http://trello.com/c/a', 'https://u:p@trello.com/c/a',
    'https://trello.com/b/a', 'https://trello.com:444/c/a']) {
    assert.throws(() => cardUrl(url), { code: 'shape' });
  }
  const d = data(); d.cards[0].name = '<img src=x onerror=alert(1)>';
  assert.equal(normalizeBoard(d, now)[0].cardName, d.cards[0].name);
});

test('nested and fallback observations normalize equally but neither certifies completeness', async () => {
  const { api } = fixture();
  const nested = await readBoard(api, board(), { now, signal: signal() });
  const fallback = await readBoard(api, board(), { now, signal: signal(), strategy: 'fallback' });
  assert.deepEqual(nested, fallback);
  assert.equal(nested.rows.length, 1);
  assert.deepEqual(nested.issues, ['collection-completeness-unverified']);
});

test('fallback resolves each missing card once and excludes only confirmed archives', async () => {
  for (const archivedList of [false, true]) {
    const { api } = fixture(); let lookups = 0;
    api.checklists = async () => [
      { id: id(20), idCard: id(30) }, { id: id(21), idCard: id(30) },
    ];
    api.lists = async () => [{ id: id(2), closed: archivedList }];
    api.card = async requested => {
      lookups++; assert.equal(requested, id(30));
      return { id: id(30), idBoard: id(1), idList: id(2), closed: !archivedList };
    };
    const result = await readBoard(api, board(), { now, signal: signal(), strategy: 'fallback' });
    assert.deepEqual(result.rows, []);
    assert.equal(lookups, 1);
    assert.equal(result.issues.length, 1);
  }
});

test('missing open, moved, unresolved and failed fallback card lookups never silently exclude', async () => {
  for (const missing of [
    { id: id(30), idBoard: id(1), idList: id(2), closed: false },
    { id: id(30), idBoard: id(99), idList: id(2), closed: true },
    { id: id(30), idBoard: id(1), idList: id(99), closed: false },
  ]) {
    const { api } = fixture();
    api.checklists = async () => [{ id: id(20), idCard: id(30) }];
    api.card = async () => missing;
    await assert.rejects(readBoard(api, board(), { now, strategy: 'fallback' }), { code: 'inconsistent' });
  }
  for (const status of [403, 404, 503]) {
    const { api } = fixture();
    api.checklists = async () => [{ id: id(20), idCard: id(30) }];
    api.card = async () => { throw new ApiError('http', status); };
    const result = await createScanner(api, { clock: () => now }).scan({ strategy: 'fallback' });
    assert.equal(result.complete, false);
    assert.equal(result.rows.length, 0);
    assert.equal(result.failedBoards[0].status, status);
  }
});

test('multi-board scan freezes eligibility, sorts ties, retains successful rows and reports failures', async () => {
  const { api } = fixture(); let time = now; const progress = [];
  api.boards = async () => [board(11), board(10), board(12), { ...board(13), closed: true }];
  api.scanCards = async boardId => {
    time += 86400000;
    if (boardId === id(12)) throw new ApiError('http', 403);
    const n = parseInt(boardId, 16);
    return [card({ id: id(100 + n), idBoard: boardId, checklists: [{
      id: id(200 + n), name: 'Checklist', checkItems: [item(300 + n)],
    }] })];
  };
  const result = await createScanner(api, { clock: () => time }).scan({ onProgress: p => progress.push(p) });
  assert.deepEqual(result.rows.map(r => r.boardId), [id(10), id(11)]);
  assert.ok(result.rows.every(r => r.elapsedMs === 86400000));
  assert.deepEqual(result.failedBoards, [{ boardId: id(12), code: 'http', status: 403 }]);
  assert.deepEqual(result.unverifiedBoardIds, [id(11), id(10)]);
  assert.deepEqual(result.completedBoardIds, []);
  assert.equal(result.complete, false);
  assert.equal(result.startedAt, now);
  assert.equal(result.finishedAt, now + 3 * 86400000);
  assert.deepEqual(progress, [0, 1, 2, 3].map(checkedBoards => ({ checkedBoards, totalBoards: 3 })));
});

test('items seen on two boards after a move cannot inflate the observed count', async () => {
  const { api } = fixture();
  api.boards = async () => [board(1), board(10)];
  api.scanCards = async boardId => [card({ idBoard: boardId })];
  const result = await createScanner(api, { clock: () => now }).scan();
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.failedBoards, [{ boardId: id(10), code: 'inconsistent', status: 0 }]);
  assert.equal(result.complete, false);
});

test('empty and partial-zero observations cannot become a complete empty scan', async () => {
  for (const mode of ['no-boards', 'no-cards', 'no-checklists', 'no-items', 'failed-list']) {
    const { api } = fixture();
    if (mode === 'no-boards') api.boards = async () => [];
    if (mode === 'no-cards') api.scanCards = async () => [];
    if (mode === 'no-checklists') api.scanCards = async () => [card({ checklists: [] })];
    if (mode === 'no-items') api.scanCards = async () => [card({
      checklists: [{ id: id(4), name: 'Checklist', checkItems: [] }],
    })];
    if (mode === 'failed-list') api.lists = async () => { throw new ApiError('http', 403); };
    const result = await createScanner(api).scan();
    assert.equal(result.complete, false);
    assert.deepEqual(result.rows, []);
    assert.equal(result.failedBoards.length, mode === 'failed-list' ? 1 : 0);
  }
});

test('cache supports selected-board reads and explicit full refresh; board-list failures are global', async () => {
  const { api, calls } = fixture();
  const scanner = createScanner(api);
  await scanner.scan({ boardId: id(1) }); await scanner.scan();
  assert.equal(calls.filter(c => c === 'boards').length, 1);
  await scanner.scan({ fullRefresh: true });
  assert.equal(calls.filter(c => c === 'boards').length, 2);
  await assert.rejects(scanner.scan({ boardId: id(90) }), { code: 'inconsistent' });
  api.boards = async () => { throw new ApiError('http', 403); };
  await assert.rejects(scanner.scan({ fullRefresh: true }), { code: 'http' });
  await assert.rejects(scanner.scan(), { code: 'http' });
});

test('401 and invalid-key errors discard the scan, invalidate cache and stop remaining requests', async () => {
  for (const code of ['unauthorized', 'setup']) {
    const { api } = fixture(); let reads = 0; let boardReads = 0; let requestSignal;
    api.boards = async () => { boardReads++; return [board(1), board(10), board(11)]; };
    api.scanCards = async (boardId, signal) => {
      requestSignal = signal; reads++;
      if (boardId === id(10)) throw new ApiError(code, 401);
      return [card({ idBoard: boardId })];
    };
    const scanner = createScanner(api);
    await assert.rejects(scanner.scan(), { code });
    assert.equal(reads, 2);
    assert.equal(requestSignal.aborted, true);
    api.boards = async () => { boardReads++; return []; };
    await scanner.scan(); assert.equal(boardReads, 2);
  }
});

test('refresh, cancellation and caller abort reject ignored late responses without publishing progress', async () => {
  for (const action of ['refresh', 'cancel', 'external']) {
    const { api } = fixture(); let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    api.scanCards = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const scanner = createScanner(api);
    const controller = new AbortController(); const progress = [];
    const first = scanner.scan({ signal: controller.signal, onProgress: p => progress.push(p) });
    await started;
    if (action === 'refresh') {
      api.scanCards = async () => [];
      assert.deepEqual((await scanner.scan()).rows, []);
    } else if (action === 'cancel') scanner.cancel();
    else controller.abort();
    const rejected = assert.rejects(first, { name: 'AbortError' });
    release([card()]); await rejected;
    assert.equal(progress.length, 1);
  }
});

test('a replaced board-list failure cannot invalidate a newer scan or its cache', async () => {
  const { api, calls } = fixture();
  let rejectOld;
  api.boards = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const scanner = createScanner(api);
  const old = scanner.scan();
  api.boards = async () => { calls.push('boards'); return [board()]; };
  await scanner.scan();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  rejectOld(new ApiError('unauthorized', 401));
  await rejected;
  await scanner.scan();
  assert.equal(calls.filter(c => c === 'boards').length, 1);
});

test('scan transport uses the actual GET wrapper with archive fields and narrow single-card lookup', async () => {
  const requests = []; let time = 0;
  const api = createApi({ appKey: 'public', token: 'CANARY_TOKEN_DO_NOT_LOG',
    now: () => time, wait: async ms => { time += ms; }, fetchImpl: async (url, options) => {
      const parsed = new URL(url); requests.push({ parsed, options, time });
      let body;
      if (parsed.pathname.endsWith('/boards')) body = [board()];
      else if (parsed.pathname.endsWith('/lists')) body = data().lists;
      else if (parsed.pathname.endsWith('/checklists')) body = [{ id: id(20), idCard: id(30) }];
      else if (parsed.pathname === `/1/cards/${id(30)}`) body = { id: id(30), idBoard: id(1), idList: id(2), closed: true };
      else body = [card()];
      return new Response(JSON.stringify(body));
    } });
  await createScanner(api, { clock: () => now }).scan();
  await createScanner(api, { clock: () => now }).scan({ strategy: 'fallback' });
  const nested = requests.find(r => r.parsed.searchParams.has('checklists'));
  assert.equal(nested.parsed.searchParams.get('checklist_fields'), 'name');
  assert.equal(nested.parsed.searchParams.get('fields'), 'name,url,idList,idBoard,closed');
  const fallback = requests.find(r => r.parsed.pathname.endsWith('/checklists'));
  assert.equal(fallback.parsed.searchParams.get('checkItems'), 'all');
  assert.equal(fallback.parsed.searchParams.get('checkItem_fields'), 'name,state,due');
  assert.equal(requests.at(-1).parsed.searchParams.get('fields'), 'idBoard,idList,closed');
  assert.ok(requests.every(r => r.options.method === 'GET' && r.parsed.origin === 'https://api.trello.com'));
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].time - requests[i - 1].time >= 200);
  assert.throws(() => api.card('../bad'), { code: 'shape' });
  assert.throws(() => api.scanCards('../bad'), { code: 'shape' });
});

test('summaries distinguish successful observations from certified coverage and empty success', () => {
  const result = { rows: [], completedBoardIds: [], unverifiedBoardIds: [id(1)],
    failedBoards: [], totalBoards: 1, complete: false, issues: ['collection-completeness-unverified'] };
  assert.equal(scanSummary(result).progress, 'Read 1 of 1 board.');
  assert.equal(scanSummary(result).summary, 'No overdue items found in the returned data.');
  assert.equal(scanSummary(result).complete, false);
  const complete = { ...result, completedBoardIds: [id(1)], unverifiedBoardIds: [], complete: true, issues: [] };
  assert.equal(scanSummary(complete).summary, 'Nothing overdue.');
  assert.equal(scanSummary(complete).coverage, '');
  assert.equal(scanSummary({ ...complete, rows: [{}] }).summary, '1 overdue item found.');
  const failed = { ...result, unverifiedBoardIds: [], failedBoards: [{ boardId: id(1) }] };
  assert.match(scanSummary(failed).coverage, /1 of 1 boards could not be checked/);
  assert.match(scanSummary(failed).coverage, /completeness has not been verified for the returned data/);
  assert.equal(scanSummary({ ...failed, complete: true }).complete, false);
});
