import { TRELLO_APP_KEY } from 'virtual:trello-config';
import { prepareAuth, AuthError } from '../../shared/auth.js';
import { createApi } from '../../shared/trello-api.js';
import { runProbe, validateBoards } from '../../shared/probe.js';
import { createScanner } from '../../shared/scan.js';
import { createResultsView } from '../../shared/results.js';
import { messageFor, show } from '../../shared/ui.js';
import '../../shared/styles.css';

const ids = ['status', 'authorize', 'retry', 'cancel-auth', 'disconnect', 'probe-panel',
  'board', 'probe', 'reload-boards', 'cancel', 'progress', 'report', 'report-details',
  'scan', 'scan-all', 'scan-refresh', 'scan-cancel', 'scan-progress', 'scan-results'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const results = createResultsView(ui['scan-results']);
let auth;
let api;
let scanner;
let boardsReady = false;
let boardNames = new Map();
let lastScan;
let generation = 0;
let controller;
let closed = false;
let consentPending = false;

function replaceWork() {
  controller?.abort();
  scanner?.cancel();
  controller = new AbortController();
  generation++;
  show(ui['scan-cancel'], false);
  setScanControls();
  return { signal: controller.signal, generation };
}
function setScanControls() {
  ui.scan.disabled = !boardsReady || !ui.board.value;
  ui['scan-all'].disabled = !boardsReady;
  ui['scan-refresh'].disabled = !boardsReady || !lastScan;
}
function clearScan() {
  results.clear();
  lastScan = undefined;
  ui['scan-progress'].textContent = '';
  show(ui['scan-refresh'], false);
}
function current(work) { return !closed && work.generation === generation && !work.signal.aborted; }
function status(text) { ui.status.textContent = text; }
function clearReport() { ui.report.textContent = ''; show(ui['report-details'], false); }
function disconnected(text) {
  api = undefined;
  scanner = undefined;
  boardsReady = false;
  boardNames = new Map();
  clearScan();
  setScanControls();
  status(text);
  clearReport();
  ui.board.replaceChildren();
  show(ui['probe-panel'], false);
  show(ui.disconnect, false);
  show(ui.authorize, true);
  ui.authorize.disabled = !auth || consentPending;
}

async function failed(error, work) {
  if (!current(work)) return;
  if (error.code === 'unauthorized') {
    const clearing = replaceWork();
    disconnected(messageFor(error));
    ui.authorize.disabled = true;
    try { await auth.clearToken(); }
    catch (storageError) { if (current(clearing)) status(messageFor(storageError)); }
    finally { if (current(clearing)) ui.authorize.disabled = false; }
  } else if (error.code === 'setup') {
    replaceWork();
    disconnected(messageFor(error));
    show(ui.authorize, false);
  } else {
    status(messageFor(error));
    show(ui.retry, true);
  }
}

async function loadBoards() {
  if (!api) return;
  boardsReady = false;
  const work = replaceWork();
  clearScan();
  clearReport();
  ui.board.replaceChildren();
  ui.probe.disabled = true;
  show(ui.cancel, true);
  show(ui.retry, false);
  ui.progress.textContent = 'Reading open boards…';
  try {
    const boards = validateBoards(await api.boards(work.signal));
    if (!current(work)) return;
    boardNames = new Map(boards.map(board => [board.id, board.name]));
    scanner = createScanner(api);
    status('Connected with read-only access. Close and reopen this modal to check authorization persistence.');
    for (const board of boards) {
      const option = document.createElement('option');
      option.value = board.id;
      option.textContent = board.name;
      ui.board.append(option);
    }
    ui.probe.disabled = boards.length === 0;
    boardsReady = true;
    setScanControls();
    ui.progress.textContent = boards.length
      ? 'Choose a board to check. Board names stay in this view; reports contain counts only.'
      : 'No open boards were returned. This is not an overdue scan.';
  } catch (error) {
    if (current(work)) {
      ui.progress.textContent = 'Board listing did not finish.';
      await failed(error, work);
    }
  } finally { if (current(work)) show(ui.cancel, false); }
}

async function connected(token) {
  if (!token || typeof token !== 'string') throw new AuthError('storage');
  api = createApi({ appKey: TRELLO_APP_KEY, token });
  status('Connected with read-only access. Close and reopen this modal to check authorization persistence.');
  show(ui.authorize, false);
  show(ui.retry, false);
  show(ui.disconnect, true);
  show(ui['probe-panel'], true);
  await loadBoards();
}

async function initialize() {
  const work = replaceWork();
  show(ui.retry, false);
  ui.authorize.disabled = true;
  status('Preparing the Trello connection…');
  try {
    const prepared = await prepareAuth(window.TrelloPowerUp, TRELLO_APP_KEY);
    const token = await prepared.getToken();
    if (!current(work)) return;
    auth = prepared;
    if (token) await connected(token);
    else disconnected('Authorize to check your Trello connection. The app requests read-only access.');
  } catch (error) {
    if (!current(work)) return;
    status(messageFor(error));
    show(ui.retry, error.code !== 'setup');
  }
}

ui.authorize.addEventListener('click', () => {
  if (!auth || consentPending) return;
  // The first SDK call happens synchronously within the click handler.
  const pending = auth.authorize();
  consentPending = true;
  const work = replaceWork();
  ui.authorize.disabled = true;
  show(ui['cancel-auth'], true);
  show(ui.retry, false);
  status('Finish consent in the Trello popup. If you close it, choose Cancel waiting here.');
  pending.then(async () => {
    if (!current(work)) return;
    const token = await auth.getToken();
    if (current(work)) await connected(token);
  }).catch(error => {
    if (current(work)) disconnected(messageFor(error));
  }).finally(() => {
    consentPending = false;
    if (!closed) {
      show(ui['cancel-auth'], false);
      ui.authorize.disabled = false;
    }
  });
});

ui['cancel-auth'].addEventListener('click', () => {
  replaceWork();
  show(ui['cancel-auth'], false);
  status('Stopped waiting. Close the consent popup and reopen this modal before trying again.');
  // SDK consent cannot be aborted. Prevent a competing popup in this view.
});
ui.retry.addEventListener('click', () => { if (api) loadBoards(); else initialize(); });
ui['reload-boards'].addEventListener('click', loadBoards);
ui.board.addEventListener('change', setScanControls);
async function scanBoards(options) {
  if (!scanner || !boardsReady) return;
  const work = replaceWork();
  results.clear();
  clearReport();
  show(ui.cancel, false);
  ui.probe.disabled = !ui.board.value;
  ui.progress.textContent = '';
  lastScan = { ...options };
  const label = options.boardId ? `Board: ${boardNames.get(options.boardId)}` : 'All open boards';
  show(ui['scan-refresh'], true);
  show(ui['scan-cancel'], true);
  ui['scan-progress'].textContent = 'Reading overdue checklist items…';
  setScanControls();
  try {
    const result = await scanner.scan({ ...options, signal: work.signal,
      onProgress: progress => {
        if (current(work)) ui['scan-progress'].textContent =
          `Checked ${progress.checkedBoards} of ${progress.totalBoards} boards…`;
      } });
    if (!current(work)) return;
    results.render(result, { label, boardNames });
    ui['scan-progress'].textContent = 'Scan finished. Review the results and completeness notice below.';
  } catch (error) {
    if (!current(work)) return;
    ui['scan-progress'].textContent = messageFor(error);
    if (error.code === 'unauthorized' || error.code === 'setup') await failed(error, work);
  } finally {
    if (current(work)) { show(ui['scan-cancel'], false); setScanControls(); }
  }
}
ui.scan.addEventListener('click', () => scanBoards({ boardId: ui.board.value }));
ui['scan-all'].addEventListener('click', () => scanBoards({}));
ui['scan-refresh'].addEventListener('click', () => { if (lastScan) scanBoards(lastScan); });
ui['scan-cancel'].addEventListener('click', () => {
  replaceWork();
  results.clear();
  ui['scan-progress'].textContent = 'Scan cancelled. No new results were recorded.';
});
ui.disconnect.addEventListener('click', async () => {
  const work = replaceWork();
  disconnected('Removing stored authorization…');
  ui.authorize.disabled = true;
  try {
    await auth.clearToken();
    if (current(work)) disconnected('Stored authorization removed. You can authorize again.');
  } catch (error) {
    if (current(work)) { status(messageFor(error)); show(ui.retry, true); }
  }
});
ui.cancel.addEventListener('click', () => {
  replaceWork();
  clearReport();
  show(ui.cancel, false);
  ui.probe.disabled = !ui.board.value;
  ui.progress.textContent = 'Check cancelled. No complete result was recorded.';
});
ui.probe.addEventListener('click', async () => {
  if (!api || !ui.board.value) return;
  const work = replaceWork();
  ui['scan-progress'].textContent = '';
  clearReport();
  show(ui.cancel, true);
  ui.probe.disabled = true;
  try {
    const report = await runProbe(api, ui.board.value, work.signal, label => {
      if (current(work)) ui.progress.textContent = `Checking ${label}…`;
    });
    if (!current(work)) return;
    ui.report.textContent = JSON.stringify(report, null, 2);
    show(ui['report-details'], true);
    ui['report-details'].open = true;
    ui.progress.textContent = 'Check finished. Review the field results below; collection completeness remains unverified.';
  } catch (error) {
    if (current(work)) { ui.progress.textContent = 'Check did not finish.'; await failed(error, work); }
  } finally {
    if (current(work)) { show(ui.cancel, false); ui.probe.disabled = !ui.board.value; }
  }
});
window.addEventListener('pagehide', () => {
  closed = true; replaceWork(); api = undefined; scanner = undefined; clearScan();
});
initialize();
