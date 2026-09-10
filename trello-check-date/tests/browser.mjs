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

async function fixture({ returning = false, denial = '', storage = false, apiStatus = 0, malformed = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', message => logs.push(message.text()));
  page.on('pageerror', error => logs.push(error.message));
  await context.route('https://p.trellocdn.com/power-up.min.js', route => route.fulfill({
    contentType: 'text/javascript', body: `
      window.calls = []; window.token = ${returning ? JSON.stringify(canary) : 'null'};
      window.TrelloPowerUp = {
        initialize(caps, options) { window.caps = caps; window.initOptions = options; },
        iframe(options) { window.iframeOptions = options; return { getRestApi: async () => ({
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
    if (url.pathname.endsWith('/members/me/boards')) body = [board];
    else if (url.pathname.endsWith('/lists')) body = [{ id: id('c'), closed: true }];
    else if (url.pathname.endsWith('/checklists')) body = [{ idCard: id('b') }];
    else if (url.pathname.endsWith('/cards')) {
      body = [structuredClone(card)];
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
  await writeFile(resolve(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} synthetic browser scenarios passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
