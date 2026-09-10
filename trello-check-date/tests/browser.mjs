// Run with Node and an existing Playwright installation. Required:
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// BROWSER_EXECUTABLE=/absolute/path/to/chrome
// TEST_SITE_DIR=/absolute/path/to/dist TEST_OUTPUT_DIR=/absolute/path/to/artifacts
// The script serves TEST_SITE_DIR under the actual production base, locally only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const site = resolve(process.env.TEST_SITE_DIR);
const output = resolve(process.env.TEST_OUTPUT_DIR);
const base = '/web-plugins/trello-check-date/';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith(base)) { res.writeHead(404).end(); return; }
  const file = resolve(site, path.slice(base.length));
  if (!file.startsWith(`${site}/`)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const results = [];
const id = character => character.repeat(24);
const canary = 'CANARY_TOKEN_DO_NOT_LOG';
const board = { id: id('a'), name: '<img src=x onerror=alert(1)> Board', closed: false };
const card = { id: id('b'), name: 'Synthetic card', url: 'https://trello.com/c/fixture',
  closed: false, idList: id('c'), idBoard: id('a'),
  checklists: [{ id: id('d'), name: 'Checklist', checkItems: [{ id: id('e'), name: 'Item',
    state: 'incomplete', due: '2026-01-01T00:00:00Z' }] }] };

async function fixture({ returning = false, denial = '', storage = false, apiStatus = 0,
  malformed = false, listsClosed = true, items, boardSet = [board], navigationFailure = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', message => logs.push(message.text()));
  page.on('pageerror', error => logs.push(error.message));
  await context.route('https://p.trellocdn.com/power-up.min.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      window.calls = []; window.token = ${returning ? JSON.stringify(canary) : 'null'};
      window.navigationFailure = ${JSON.stringify(navigationFailure)};
      window.TrelloPowerUp = {
        initialize(caps, options) { window.caps = caps; window.initOptions = options; },
        iframe(options) { window.iframeOptions = options; return {
          navigate(options) {
            window.calls.push({navigate: options, active: navigator.userActivation.isActive});
            if (window.navigationFailure === 'throw') throw new Error('private navigation error');
            if (window.navigationFailure === 'reject') return Promise.reject(new Error('private navigation error'));
            return Promise.resolve();
          },
          getRestApi: async () => ({
          getToken: async () => { if (${storage}) throw new Error('private SDK error'); return window.token; },
          clearToken: async () => { window.calls.push('clear'); window.token = null; },
          authorize(options) {
            window.calls.push({options, active: navigator.userActivation.isActive});
            if (${JSON.stringify(denial)} === 'pending') return new Promise(() => {});
            if (${JSON.stringify(denial)}) return Promise.reject({name: ${JSON.stringify(denial)}});
            window.token = ${JSON.stringify(canary)}; return Promise.resolve(window.token);
          }
        }) }; }
      };`,
  }));
  const requests = [];
  await context.route('https://api.trello.com/**', async route => {
    const url = new URL(route.request().url());
    assert.equal(route.request().method(), 'GET');
    assert.equal(url.searchParams.get('token'), canary);
    requests.push(url.pathname);
    if (apiStatus) {
      await route.fulfill({ status: apiStatus, body: apiStatus === 400 ? 'invalid key' : 'private error' }); return;
    }
    let body;
    if (url.pathname.endsWith('/members/me/boards')) body = boardSet;
    else if (url.pathname.endsWith('/lists')) body = [{ id: id('c'), closed: listsClosed }];
    else if (url.pathname.endsWith('/checklists')) body = [{ idCard: id('b') }];
    else if (url.pathname.endsWith('/cards')) {
      body = [structuredClone(card)];
      body[0].idBoard = url.pathname.split('/')[3];
      if (items) body[0].checklists[0].checkItems = structuredClone(items);
      if (body[0].idBoard !== board.id) {
        body[0].id = id('9');
        body[0].checklists[0].id = id('8');
        for (const item of body[0].checklists[0].checkItems) item.id = `7${item.id.slice(1)}`;
      }
      if (malformed && url.searchParams.get('checklist_fields')) delete body[0].checklists[0].checkItems;
    } else throw new Error('Unexpected endpoint');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { context, page, requests, logs };
}

async function scenario(name, options, fn) {
  const f = await fixture(options);
  try {
    await fn(f);
    assert.ok(!f.logs.join('\n').includes(canary), 'Token reached console');
    assert.ok(!(await f.page.locator('body').innerText()).includes(canary), 'Token reached UI');
    results.push({ name, passed: true });
  } finally { await f.context.close(); }
}

try {
  await scenario('connector config and fullscreen production URL', {}, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/connector.html`);
    await page.waitForFunction(() => window.caps);
    const details = await page.evaluate(async () => {
      const [button] = await window.caps['board-buttons']();
      let modal;
      await button.callback({ modal: options => { modal = options; } });
      return { text: button.text, icon: button.icon, modal, options: window.initOptions };
    });
    assert.equal(details.text, 'Overdue items');
    assert.equal(details.modal.fullscreen, true);
    assert.equal(details.modal.url, `${base}apps/overdue-checklist/view.html`);
    assert.equal(details.options.appName, 'Overdue Checklist Items');
    for (const [background, ink] of [['dark', '#ffffff'], ['light', '#172b4d']]) {
      const url = details.icon[background];
      assert.ok(url.startsWith('data:image/svg+xml') || url.startsWith(base));
      const actualInk = await page.evaluate(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Icon failed to load');
        const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
        return svg.documentElement.getAttribute('stroke');
      }, url);
      assert.equal(actualInk, ink, `Icon must contrast with the ${background} board background`);
    }
  });
  await scenario('gesture auth, safe rendering, narrow view and count report', { malformed: true }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByRole('button', { name: 'Authorize (read-only)' }).click();
    await page.waitForFunction(() => !document.querySelector('#probe').disabled);
    const call = await page.evaluate(() => window.calls[0]);
    assert.deepEqual(call, { options: { scope: 'read', expiration: 'never' }, active: true });
    assert.equal(await page.locator('#board option').textContent(), board.name);
    assert.equal(await page.locator('img').count(), 0);
    await page.getByRole('button', { name: 'Run integration check' }).click();
    await page.locator('#report-details').waitFor({ state: 'visible' });
    const report = JSON.parse(await page.locator('#report').innerText());
    assert.equal(report.nameProjection.shapeValid, false);
    assert.equal(report.defaultProjection.shapeValid, true);
    assert.equal(report.archivesAndFallback.openCardsInArchivedLists, 1);
    assert.equal(report.collectionCompleteness, 'unverified');
    assert.ok(!(await page.locator('#report').innerText()).includes(board.name));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, 'synthetic-preview-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: resolve(output, 'synthetic-preview-desktop.png'), fullPage: true });
  });
  for (const [name, options, text] of [
    ['denied consent', { denial: 'AuthDeniedError' }, 'Authorization was denied'],
    ['cancelled consent', { denial: 'AuthCancelledError' }, 'Authorization was cancelled'],
    ['unknown consent error', { denial: 'Error' }, 'Consent could not finish'],
  ]) await scenario(name, options, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByRole('button', { name: 'Authorize (read-only)' }).click();
    await page.getByText(text, { exact: false }).waitFor();
    assert.equal(await page.locator('#authorize').isEnabled(), true);
  });
  await scenario('closed popup can stop waiting without competing consent', { denial: 'pending' }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByRole('button', { name: 'Authorize (read-only)' }).click();
    await page.getByRole('button', { name: 'Cancel waiting' }).click();
    await page.getByText('Stopped waiting.', { exact: false }).waitFor();
    assert.equal(await page.locator('#authorize').isDisabled(), true);
  });
  await scenario('returning token and forgetting authorization', { returning: true }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByRole('button', { name: 'Forget authorization' }).click();
    await page.getByText('Stored authorization removed.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.includes('clear')), true);
  });
  await scenario('revoked token clears SDK storage', { returning: true, apiStatus: 401 }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByText('Authorization has expired or been revoked.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.includes('clear')), true);
    assert.equal(await page.locator('#authorize').isVisible(), true);
  });
  await scenario('invalid app key does not clear user token', { returning: true, apiStatus: 400 }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByText('Setup required:', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.includes('clear')), false);
    assert.equal(await page.locator('#authorize').isVisible(), false);
  });
  await scenario('storage failure gives recovery message', { storage: true }, async ({ page }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.getByText('Trello authorization storage is unavailable.', { exact: false }).waitFor();
  });
  await scenario('cancelled check cannot publish late response', { returning: true }, async ({ page, context }) => {
    await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
    await page.waitForFunction(() => !document.querySelector('#probe').disabled);
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await context.route('https://api.trello.com/1/boards/*/cards?*', async route => {
      await blocked;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([card]) }).catch(() => {});
    });
    await page.getByRole('button', { name: 'Run integration check' }).click();
    await page.getByRole('button', { name: 'Cancel check', exact: true }).click();
    release();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#report-details').isVisible(), false);
    assert.match(await page.locator('#progress').innerText(), /cancelled/);
  });
  const instant = Date.now();
  const scanItems = [
    { id: id('1'), name: 'Alpha <img src=x onerror=alert(1)>', state: 'incomplete',
      due: new Date(instant - 10.5 * 86400000).toISOString() },
    { id: id('2'), name: 'Zulu item', state: 'incomplete',
      due: new Date(instant - 2.5 * 86400000).toISOString() },
    { id: id('3'), name: 'Complete item', state: 'complete', due: new Date(instant - 86400000).toISOString() },
    { id: id('4'), name: 'Future item', state: 'incomplete', due: new Date(instant + 86400000).toISOString() },
    { id: id('5'), name: 'Undated item', state: 'incomplete', due: null },
  ];
  await scenario('display modes reuse frozen observations, sort dates and blanks, and survive refresh',
    { returning: true, listsClosed: false, items: [...scanItems,
      { id: id('6'), name: 'Equal-now item', state: 'incomplete', due: new Date(instant).toISOString() }] },
    async ({ page, requests }) => {
      // Fixed Date leaves request scheduling timers running normally.
      await page.clock.setFixedTime(instant);
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      const mode = page.getByLabel('Show', { exact: true });
      assert.equal(await mode.inputValue(), 'overdue');
      const requestCount = requests.length;
      const scanTime = await page.locator('#scan-time').innerText();
      await page.clock.setFixedTime(instant + 2 * 86400000);
      await mode.selectOption('all');
      assert.equal(await page.locator('#scan-summary').innerText(), '5 active items found.');
      const rows = page.locator('tbody tr');
      assert.deepEqual(await rows.locator('td:first-child').allTextContents(),
        [scanItems[0].name, scanItems[1].name, 'Equal-now item', 'Future item', 'Undated item'].map(n => `${n}Checklist`));
      assert.deepEqual(await rows.locator('td:last-child').allTextContents(), ['10', '2', '—', '—', '—']);
      assert.equal(await rows.last().locator('td').nth(3).innerText(), '—');
      assert.equal(await rows.last().locator('time').count(), 0);
      await page.getByRole('button', { name: 'Due', exact: true }).click();
      assert.match(await rows.first().innerText(), /^Future item/);
      assert.match(await rows.last().innerText(), /^Undated item/);
      const days = page.getByRole('button', { name: 'Days overdue', exact: true });
      await days.click();
      assert.deepEqual(await rows.locator('td:last-child').allTextContents(), ['10', '2', '—', '—', '—']);
      await days.click();
      assert.deepEqual(await rows.locator('td:last-child').allTextContents(), ['2', '10', '—', '—', '—']);
      await mode.selectOption('dated');
      assert.equal(await page.locator('#scan-summary').innerText(), '4 active dated items found.');
      assert.match(await rows.first().innerText(), /^Alpha/);
      assert.equal(await page.getByRole('button', { name: 'Due', exact: true })
        .evaluate(node => node.parentElement.getAttribute('aria-sort')), 'ascending');
      await mode.selectOption('overdue');
      assert.equal(await rows.count(), 2, 'Mode switch must not recompute overdue at wall-clock time');
      assert.equal(await page.locator('#scan-time').innerText(), scanTime);
      assert.equal(requests.length, requestCount, 'Mode switches must not refetch');
      await mode.selectOption('all');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(output, 'synthetic-filters-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.screenshot({ path: resolve(output, 'synthetic-filters-desktop.png'), fullPage: true });
      await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.equal(await mode.inputValue(), 'all');
      assert.equal(await rows.count(), 5);
      assert.ok(requests.length > requestCount);
      await mode.selectOption('overdue');
      assert.equal(await rows.count(), 4, 'Refresh advances the frozen scan timestamp');
      await page.getByRole('button', { name: 'Forget authorization', exact: true }).click();
      await page.getByText('Stored authorization removed.', { exact: false }).waitFor();
      assert.equal(await page.locator('#scan-results').isVisible(), false);
    });
  await scenario('selected-board table, keyboard and numeric sorting, links, safe names and responsive layout',
    { returning: true, listsClosed: false, items: scanItems }, async ({ page }) => {
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#scan-summary').innerText(), '2 overdue items found.');
      assert.match(await page.locator('#scan-time').innerText(), /Read 1 of 1 board/);
      assert.match(await page.locator('#scan-coverage').innerText(), /completeness has not been verified/);
      const rows = page.locator('tbody tr');
      assert.equal(await rows.count(), 2);
      assert.equal(await page.locator('img').count(), 0);
      assert.ok((await rows.first().innerText()).includes(scanItems[0].name));
      const itemSort = page.getByRole('button', { name: 'Item', exact: true });
      await itemSort.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      assert.ok((await rows.first().innerText()).startsWith('Zulu'));
      assert.equal(await itemSort.evaluate(node => node === document.activeElement), true);
      assert.equal(await itemSort.evaluate(node => node.parentElement.getAttribute('aria-sort')), 'descending');
      const daysSort = page.getByRole('button', { name: 'Days overdue', exact: true });
      await daysSort.click();
      assert.deepEqual(await page.locator('tbody tr td:last-child').allTextContents(), ['10', '2']);
      await daysSort.click();
      assert.deepEqual(await page.locator('tbody tr td:last-child').allTextContents(), ['2', '10']);
      const link = rows.first().getByRole('link');
      assert.equal(await link.innerText(), 'Open in new tab');
      assert.equal(await link.getAttribute('href'), card.url);
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(output, 'synthetic-scan-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: resolve(output, 'synthetic-scan-desktop.png'), fullPage: true });
      const before = await page.locator('#scan-summary').innerText();
      await page.getByRole('button', { name: 'Run integration check' }).click();
      await page.locator('#report-details').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#scan-summary').innerText(), before);
    });
  const secondBoard = { id: id('f'), name: 'Second board', closed: false };
  for (const otherBoard of [false, true]) {
    await scenario(`card actions use SDK navigation and an isolated new tab (${otherBoard ? 'other' : 'current'} board)`,
      { returning: true, listsClosed: false, boardSet: [board, secondBoard] },
      async ({ page, context, requests }) => {
        await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
        await page.locator('#board').selectOption(otherBoard ? secondBoard.id : board.id);
        await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
        await page.locator('#scan-results').waitFor({ state: 'visible' });
        const row = page.locator('tbody tr').first();
        assert.equal(await row.getByRole('link', { name: card.name, exact: true }).count(), 0);
        const here = row.getByRole('button', { name: `Open here: ${card.name}`, exact: true });
        const newTab = row.getByRole('link', { name: `Open in new tab: ${card.name}`, exact: true });
        for (const control of [here, newTab]) {
          assert.ok((await control.boundingBox()).height >= 44);
        }
        const requestCount = requests.length;
        await here.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.calls.some(call => call.navigate));
        const call = await page.evaluate(() => window.calls.find(call => call.navigate));
        assert.deepEqual(call, { navigate: { url: card.url }, active: true });
        assert.equal(context.pages().length, 1, 'Open here must not create another tab');
        assert.equal(requests.length, requestCount, 'Navigation makes no app REST request');
        assert.equal(await here.isEnabled(), true);
        await context.route('https://trello.com/c/fixture', route => {
          assert.equal(route.request().headers().referer, undefined);
          return route.fulfill({ contentType: 'text/html', body: '<title>Synthetic Trello card</title>' });
        });
        const popupPromise = page.waitForEvent('popup');
        await newTab.focus();
        await page.keyboard.press('Enter');
        const popup = await popupPromise;
        await popup.waitForLoadState();
        assert.equal(popup.url(), card.url);
        assert.equal(await popup.evaluate(() => window.opener), null);
        assert.equal(page.url(), `${origin}${base}apps/overdue-checklist/view.html`);
        await popup.close();
        if (!otherBoard) {
          await page.screenshot({ path: resolve(output, 'synthetic-card-actions-mobile.png'), fullPage: true });
          await page.setViewportSize({ width: 1280, height: 1100 });
          await page.screenshot({ path: resolve(output, 'synthetic-card-actions-desktop.png'), fullPage: true });
        }
      });
  }
  for (const navigationFailure of ['throw', 'reject']) {
    await scenario(`navigation ${navigationFailure} is sanitized and retryable without losing scan results`,
      { returning: true, listsClosed: false, navigationFailure }, async ({ page }) => {
        await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
        await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
        await page.locator('#scan-results').waitFor({ state: 'visible' });
        const here = page.getByRole('button', { name: `Open here: ${card.name}`, exact: true });
        await here.click();
        await page.getByText('Could not open this card here.', { exact: false }).waitFor();
        assert.equal(await here.isEnabled(), true);
        assert.equal(await page.locator('tbody tr').count(), 1);
        assert.equal(await page.locator('#scan-coverage').isVisible(), true);
        assert.doesNotMatch(await page.locator('body').innerText(), /private navigation error/);
        await page.evaluate(() => { window.navigationFailure = ''; });
        await here.click();
        assert.equal(await page.locator('.card-navigation-error').innerText(), '');
        assert.equal(await page.evaluate(() => window.calls.filter(call => call.navigate).length), 2);
        assert.equal(await page.evaluate(() => window.calls.includes('clear')), false);
      });
  }
  await scenario('explicit board selection reads only that board and refresh reuses board cache',
    { returning: true, listsClosed: false, boardSet: [board, secondBoard] }, async ({ page, requests }) => {
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.locator('#board').selectOption(secondBoard.id);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.ok(requests.filter(path => path.includes('/boards/')).every(path => path.includes(secondBoard.id)));
      const boardReads = requests.filter(path => path.endsWith('/members/me/boards')).length;
      await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.equal(requests.filter(path => path.endsWith('/members/me/boards')).length, boardReads);
      assert.equal(await page.locator('#scan-scope').innerText(), 'Board: Second board');
      await page.getByRole('button', { name: 'Reload board list', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#scan').disabled);
      assert.equal(requests.filter(path => path.endsWith('/members/me/boards')).length, boardReads + 1);
      assert.equal(await page.locator('#scan-results').isVisible(), false);
    });
  await scenario('all-board scan reports a failed board and preserves successful observations',
    { returning: true, listsClosed: false, boardSet: [board, secondBoard] }, async ({ page, context }) => {
      await context.route(`https://api.trello.com/1/boards/${secondBoard.id}/lists?*`, route =>
        route.fulfill({ status: 403, body: 'private detail' }));
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan all boards', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#scan-summary').innerText(), '1 overdue item found.');
      assert.match(await page.locator('#scan-coverage').innerText(), /1 of 2 boards could not be checked/);
      assert.match(await page.locator('#scan-coverage').innerText(), /completeness has not been verified for the returned data/);
      assert.match(await page.locator('#scan-errors').innerText(), /Second board/);
      assert.doesNotMatch(await page.locator('#scan-errors').innerText(), /private detail/);
      assert.match(await page.locator('#scan-time').innerText(), /Read 1 of 2 boards/);
      for (const mode of ['all', 'dated', 'overdue']) {
        await page.locator('#item-mode').selectOption(mode);
        assert.match(await page.locator('#scan-coverage').innerText(), /1 of 2 boards could not be checked/);
        assert.match(await page.locator('#scan-coverage').innerText(), /completeness has not been verified for the returned data/);
      }
    });
  await scenario('zero observed rows remain unverified rather than empty success',
    { returning: true, listsClosed: false, items: [scanItems[2]] }, async ({ page }) => {
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#scan-summary').innerText(), 'No overdue items found in the returned data.');
      assert.doesNotMatch(await page.locator('#scan-results').innerText(), /Nothing overdue/);
      assert.equal(await page.locator('table').isVisible(), false);
      assert.equal(await page.locator('#scan-coverage').isVisible(), true);
      for (const [mode, description] of [['all', 'active'], ['dated', 'active dated'], ['overdue', 'overdue']]) {
        await page.locator('#item-mode').selectOption(mode);
        assert.equal(await page.locator('#scan-summary').innerText(), `No ${description} items found in the returned data.`);
        assert.equal(await page.locator('table').isVisible(), false);
        assert.equal(await page.locator('#scan-coverage').isVisible(), true);
      }
    });
  await scenario('token revoked during a scan clears results and returns to authorize',
    { returning: true, listsClosed: false }, async ({ page, context }) => {
      await context.route('https://api.trello.com/1/boards/*/cards?*', route =>
        route.fulfill({ status: 401, body: 'invalid token' }));
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.getByText('Authorization has expired or been revoked.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.calls.includes('clear')), true);
      assert.equal(await page.locator('#scan-results').isVisible(), false);
      assert.equal(await page.locator('#authorize').isVisible(), true);
    });
  await scenario('a cancelled scan cannot publish a late response',
    { returning: true, listsClosed: false }, async ({ page, context }) => {
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      await context.route('https://api.trello.com/1/boards/*/cards?*', async route => {
        await blocked;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([card]) }).catch(() => {});
      });
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel scan', exact: true }).click();
      release();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#scan-results').isVisible(), false);
      assert.match(await page.locator('#scan-progress').innerText(), /cancelled/);
      assert.equal(await page.locator('#scan').isEnabled(), true);
    });
  await scenario('refresh during a pending scan publishes only the newer result',
    { returning: true, listsClosed: false }, async ({ page, context }) => {
      let release;
      let entered;
      const started = new Promise(resolve => { entered = resolve; });
      const blocked = new Promise(resolve => { release = resolve; });
      let reads = 0;
      await context.route('https://api.trello.com/1/boards/*/cards?*', async route => {
        reads++;
        const body = structuredClone(card);
        if (reads === 1) { entered(); await blocked; }
        else body.checklists[0].checkItems = scanItems;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify([body]) }).catch(() => {});
      });
      await page.goto(`${origin}${base}apps/overdue-checklist/view.html`);
      await page.getByRole('button', { name: 'Scan selected board', exact: true }).click();
      await started;
      await page.getByRole('button', { name: 'Refresh results', exact: true }).click();
      await page.locator('#scan-results').waitFor({ state: 'visible' });
      release();
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#scan-summary').innerText(), '2 overdue items found.');
      assert.equal(await page.locator('tbody tr').count(), 2);
      await page.locator('#item-mode').selectOption('all');
      assert.equal(await page.locator('tbody tr').count(), 4, 'Only newer active observations survive refresh');
    });
  await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} synthetic browser scenarios passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
