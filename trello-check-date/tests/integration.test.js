import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAuth } from '../shared/auth.js';
import { createApi, ApiError } from '../shared/trello-api.js';
import { inspectCards, inspectArchives, runProbe, validateBoards } from '../shared/probe.js';
import { messageFor } from '../shared/ui.js';

const boardId = 'a'.repeat(24);
const cardId = 'b'.repeat(24);
const listId = 'c'.repeat(24);
const checklistId = 'd'.repeat(24);
const itemId = 'e'.repeat(24);
const card = () => ({ id: cardId, name: 'Private card', url: 'https://trello.com/c/fixture',
  idList: listId, closed: false, checklists: [{ id: checklistId, name: 'Private checklist',
    checkItems: [{ id: itemId, name: 'Private item', state: 'incomplete', due: '2026-09-01T00:00:00Z' }] }] });
const signal = () => new AbortController().signal;
const response = (body, status = 200, headers = {}) => new Response(
  typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

test('auth prepares asynchronous SDK client, authorizes synchronously with read-only scope, clears token', async () => {
  const calls = [];
  const client = { authorize: options => { calls.push(options); return Promise.resolve('secret'); },
    getToken: async () => 'secret', clearToken: async () => calls.push('clear') };
  const auth = await prepareAuth({ iframe: options => {
    assert.equal(options.appName, 'Overdue Checklist Items');
    return { getRestApi: async () => client };
  } }, 'key');
  const consent = auth.authorize();
  assert.deepEqual(calls, [{ scope: 'read', expiration: 'never' }]);
  await consent;
  assert.equal(await auth.getToken(), 'secret');
  await auth.clearToken();
  assert.equal(calls.at(-1), 'clear');
});

test('missing key, SDK, storage, denied and cancelled consent have sanitized errors', async () => {
  await assert.rejects(prepareAuth({}, ''), { code: 'setup' });
  await assert.rejects(prepareAuth(null, 'key'), { code: 'sdk' });
  await assert.rejects(prepareAuth({ iframe() { throw new Error('secret'); } }, 'key'), { code: 'storage' });
  for (const [name, code] of [['AuthDeniedError', 'denied'], ['AuthCancelledError', 'cancelled'], ['Error', 'consent']]) {
    const auth = await prepareAuth({ iframe: () => ({ getRestApi: async () => ({
      authorize() { throw Object.assign(new Error('secret'), { name }); },
    }) }) }, 'key');
    await assert.rejects(auth.authorize(), error => error.code === code && !messageFor(error).includes('secret'));
  }
});

test('shape report detects omitted arrays and invalid items instead of empty success', () => {
  assert.equal(inspectCards([card()]).shapeValid, true);
  assert.equal(inspectCards([]).itemFieldsObserved, false);
  const missing = card(); delete missing.checklists[0].checkItems;
  assert.equal(inspectCards([missing]).shapeValid, false);
  assert.equal(inspectCards([missing]).missingItemArrays, 1);
  assert.equal(inspectCards([{ ...card(), checklists: undefined }]).missingChecklistArrays, 1);
  for (const changes of [{ due: 'invalid' }, { due: undefined }, { state: 'unknown' }, { id: '' }]) {
    const invalid = card(); Object.assign(invalid.checklists[0].checkItems[0], changes);
    assert.equal(inspectCards([invalid]).shapeValid, false);
  }
  const nullDue = card(); nullDue.checklists[0].checkItems[0].due = null;
  assert.equal(inspectCards([nullDue]).shapeValid, true);
  assert.equal(inspectCards([card(), card()]).shapeValid, false);
  assert.throws(() => inspectCards({}), { code: 'shape' });
});

test('archive probe counts open cards in archived lists and does not infer unmatched cards are archived', () => {
  const result = inspectArchives([card()], [{ id: listId, closed: true }],
    [{ idCard: cardId }, { idCard: 'f'.repeat(24) }]);
  assert.equal(result.openCardsInArchivedLists, 1);
  assert.equal(result.unmatchedFallbackCards, 1);
  assert.equal(result.joinClassification, 'pending-targeted-lookup-verification');
  assert.equal(inspectArchives([card()], [], []).unresolvedLists, 1);
  assert.throws(() => inspectArchives([card()], [{ id: listId, closed: 'false' }], []), { code: 'shape' });
});

test('board list validates required fields and excludes archived boards', () => {
  assert.deepEqual(validateBoards([{ id: boardId, name: 'Archived', closed: true }]), []);
  assert.throws(() => validateBoards([{ id: boardId, name: 'Missing closed' }]), { code: 'shape' });
});

test('probe exports fixed fields/counts only, continues local errors, never certifies completeness', async () => {
  const api = { projectedCards: async () => { throw new ApiError('http', 403); },
    defaultCards: async () => [card()], metadata: async () => [card()],
    lists: async () => [{ id: listId, closed: false }], checklists: async () => [{ idCard: cardId }] };
  const report = await runProbe(api, boardId, signal());
  assert.equal(report.nameProjection.status, 403);
  assert.equal(report.defaultProjection.items, 1);
  assert.equal(report.collectionCompleteness, 'unverified');
  assert.doesNotMatch(JSON.stringify(report), /Private|https:|aaaaaa|bbbbbb/);
  api.projectedCards = async () => { throw new ApiError('unauthorized', 401); };
  await assert.rejects(runProbe(api, boardId, signal()), { code: 'unauthorized' });
});

test('transport fixes origin, method, projection comparison, pacing and redirect policy', async () => {
  const calls = []; let time = 0;
  const api = createApi({ appKey: 'public', token: 'CANARY_TOKEN_DO_NOT_LOG', now: () => time,
    wait: async ms => { time += ms; }, fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options, time }); return response([]);
    } });
  await api.projectedCards(boardId, signal()); await api.defaultCards(boardId, signal());
  assert.equal(calls[0].url.searchParams.get('checklist_fields'), 'name');
  assert.equal(calls[1].url.searchParams.has('checklist_fields'), false);
  assert.ok(calls[1].time - calls[0].time >= 200);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://api.trello.com');
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
  }
  assert.throws(() => api.metadata('../https://evil.test', signal()), { code: 'shape' });
});

test('429, 5xx and network errors have bounded retries; server delay is honored', async () => {
  for (const status of [429, 503, 0]) {
    let calls = 0; const waits = [];
    const api = createApi({ appKey: 'key', token: 'secret', wait: async ms => waits.push(ms), random: () => 0,
      fetchImpl: async () => { calls++; if (!status) throw new Error('URL with secret');
        return response('', status, { 'retry-after': '2' }); } });
    await assert.rejects(api.boards(signal()), error => !error.message.includes('secret'));
    assert.equal(calls, 4);
    if (status) assert.ok(waits.filter(ms => ms >= 2000).length >= 3);
  }
});

test('401 token versus invalid key and 403 are distinct; invalid JSON never leaks', async () => {
  for (const [body, status, code] of [['invalid token', 401, 'unauthorized'],
    ['invalid key', 401, 'setup'], ['private secret', 403, 'http'], ['not JSON secret', 200, 'shape']]) {
    let calls = 0;
    const api = createApi({ appKey: 'key', token: 'secret', wait: async () => {}, fetchImpl: async () => {
      calls++; return response(body, status);
    } });
    await assert.rejects(api.boards(signal()), error => error.code === code && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('cancellation rejects an ignored late response and stops retries', async () => {
  const control = new AbortController(); let calls = 0;
  const api = createApi({ appKey: 'key', token: 'secret', wait: async () => {},
    fetchImpl: async () => { calls++; control.abort(); return response([]); } });
  await assert.rejects(api.boards(control.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
