// End-to-end check of the BUILT plugin in a real JBrowse Desktop release,
// installed the way users do it: Tools → Plugin store → Add custom plugin,
// with the plugin name and an http(s) URL.
// Run with Node and an existing Playwright installation. Required:
//   PLAYWRIGHT_MODULE=/abs/path/to/playwright/index.mjs
//   JBROWSE_DESKTOP_BIN=/abs/path/to/extracted/AppImage/jbrowse-desktop.bin
//   TEST_OUTPUT_DIR=/abs/path/for/screenshots/and/report
// Optional: PLUGIN_DIST_DIR (default ../../dist); XVFB_RUN (default xvfb-run,
// set to "" when a display is available). Desktop runs with a throwaway HOME.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPECTED, QUERY, assemblyConfig, buildGenomes, serve, writeFasta } from './fixture.mjs';
import { decodeResults } from '../../src/search/results.js';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bin = resolve(process.env.JBROWSE_DESKTOP_BIN);
const distDir = resolve(process.env.PLUGIN_DIST_DIR || join(here, '../../dist'));
const out = resolve(process.env.TEST_OUTPUT_DIR);
const xvfb = process.env.XVFB_RUN ?? 'xvfb-run';
const pkg = JSON.parse(await readFile(join(here, '../../package.json'), 'utf8'));
const pluginPath = `/plugins/jbrowse-sequence-search/${pkg.version}/jbrowse-sequence-search.js`;
const home = join(out, 'home');
await mkdir(join(out, 'data'), { recursive: true });
await mkdir(home, { recursive: true });

const genomes = buildGenomes();
await writeFasta(join(out, 'data'), 'testgenome', genomes.testgenome);
const requests = [];
const { server, origin } = await serve({ '/plugins/': distDir, '/data/': join(out, 'data') }, requests);
const pluginUrl = `${origin}${pluginPath}`;

function sessionFile(plugins) {
  return {
    plugins,
    assemblies: [assemblyConfig('testgenome', `${origin}/data`)],
    tracks: [],
    defaultSession: {
      name: 'Desktop genome search test',
      views: [{ id: 'viewTest', type: 'LinearGenomeView', init: { assembly: 'testgenome', loc: 'ctgA:1-5000', tracks: ['testgenome-reference'] } }],
    },
  };
}
const sessionPath = join(out, 'desktop-test.jbrowse');
await writeFile(sessionPath, JSON.stringify(sessionFile([]), null, 2));
const filePluginSession = join(out, 'file-url-plugin.jbrowse');
await writeFile(filePluginSession, JSON.stringify(sessionFile([
  { name: 'GenomeSequenceSearch', url: pathToFileURL(join(distDir, 'jbrowse-sequence-search', pkg.version, 'jbrowse-sequence-search.js')).href },
]), null, 2));

let cdpPort = 9400 + Math.floor(Math.random() * 500);
async function launch(file) {
  cdpPort += 1;
  const args = [bin, '--no-sandbox', `--remote-debugging-port=${cdpPort}`, file];
  // Own process group, so quitting also stops Electron's helper processes.
  const options = { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }, stdio: 'ignore', detached: true };
  const child = xvfb
    ? spawn(xvfb, ['-a', '-s', '-screen 0 1400x950x24', ...args], options)
    : spawn(args[0], args.slice(1), options);
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise(r => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`).catch(() => undefined);
  }
  assert.ok(browser, 'Desktop did not expose a debugging port');
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html'));
    if (!page) await new Promise(r => setTimeout(r, 250));
  }
  await page.setViewportSize({ width: 1400, height: 950 }).catch(() => {});
  return { child, browser, page };
}
async function quit(app) {
  await app.browser.close().catch(() => {});
  try { process.kill(-app.child.pid, 'SIGTERM'); } catch { /* already gone */ }
  await new Promise(r => setTimeout(r, 2000));
}

const checks = [];
let app;
let shot = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
    console.log(`ok - ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`not ok - ${name}\n${e?.stack || e}`);
    await app?.page.screenshot({ path: join(out, `failure-${checks.length}.png`) }).catch(() => {});
  }
}
const screenshot = async label => {
  shot += 1;
  await app.page.screenshot({ path: join(out, `${String(shot).padStart(2, '0')}-${label}.png`) });
};
const locationText = () => app.page.evaluate(() => [...document.querySelectorAll('input')].map(i => i.value).find(v => /^ctg[ABC]:/.test(v)));
const position = () => app.page.getByTestId('genome-search-position').innerText();
const viewReady = () => app.page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => /^ctgA:/.test(i.value)), null, { timeout: 60_000 });

async function findSavedResults() {
  // Desktop writes sessions to the opened file and to autosaves under HOME.
  const candidates = [sessionPath];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (/\.(json|jbrowse)$/.test(entry.name)) candidates.push(p);
    }
  }
  await walk(home);
  for (const file of candidates) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text.includes('GenomeSequenceSearchResultsAdapter')) continue;
    const json = JSON.parse(text);
    const tracks = [...(json.tracks ?? []), ...(json.defaultSession?.sessionTracks ?? []), ...(json.session?.sessionTracks ?? [])];
    const track = tracks.filter(t => t.adapter?.type === 'GenomeSequenceSearchResultsAdapter').at(-1);
    if (track) return { file, track, plugins: json.plugins };
  }
  return undefined;
}

app = await launch(sessionPath);
const version = await app.page.evaluate(() => navigator.userAgent.match(/JBrowse2\/(\S+)/)?.[1]);

await check('Desktop opens the test session', async () => {
  await viewReady();
  await app.page.waitForTimeout(1500);
  await screenshot('desktop-session-without-plugin');
  return { desktopVersion: version, userAgent: await app.page.evaluate(() => navigator.userAgent) };
});

await check('install via Plugin store → Add custom plugin (name + hosted URL)', async () => {
  const { page } = app;
  await page.getByText('Tools', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Plugin store' }).click();
  await page.getByRole('button', { name: /Add custom plugin/i }).click();
  await page.getByLabel('Plugin name').fill('GenomeSequenceSearch');
  await page.getByLabel('Plugin URL').fill(pluginUrl);
  await page.getByRole('button', { name: 'Submit' }).and(page.locator(':not([disabled])')).waitFor();
  await screenshot('add-custom-plugin-dialog');
  await page.getByRole('button', { name: 'Submit' }).click();
  // Desktop saves the session and reloads it with the plugin.
  await page.getByText(`GenomeSequenceSearch (v${pkg.version})`).waitFor({ timeout: 60_000 });
  await screenshot('plugin-installed');
  const cancel = page.getByRole('button', { name: 'Cancel' });
  if (await cancel.isVisible()) await cancel.click();
  await viewReady();
  await page.getByText('Tools', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Search genome…' }).waitFor({ timeout: 30_000 });
  const fetched = requests.filter(p => p === pluginPath).length;
  assert.ok(fetched >= 2, `plugin fetched ${fetched} times (UI and worker)`);
  return { pluginUrl, fetched };
});

await check('whole-assembly search lists every planted hit', async () => {
  const { page } = app;
  await page.getByRole('menuitem', { name: 'Search genome…' }).click();
  await page.getByTestId('genome-search-query').fill(QUERY);
  await page.getByTestId('genome-search-submit').click();
  await page.getByTestId('genome-search-outcome').waitFor({ timeout: 60_000 });
  const text = await page.getByTestId('genome-search-outcome').innerText();
  assert.match(text, /Found 6 matches\. Searched all 3 sequences of testgenome/);
  const rows = (await page.getByTestId('genome-search-row').allInnerTexts()).map(r => r.replace(/\s+/g, ' '));
  assert.deepEqual(rows.map(r => r.split(' ').slice(1, 5).join(' ')), EXPECTED.map(h =>
    `${h.refName} ${(h.start + 1).toLocaleString('en-US')} ${h.end.toLocaleString('en-US')} ${h.strand === 1 ? '+' : '−'}`));
  await screenshot('desktop-results');
  return { rows };
});

await check('clicking a result and Previous/Next navigate the view', async () => {
  const { page } = app;
  await page.getByTestId('genome-search-row').nth(3).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => /^ctgB:1\.\.\d+/.test(i.value)), null, { timeout: 30_000 });
  assert.match(await position(), /Match 4 of 6: ctgB:1-20/);
  await screenshot('desktop-navigated-ctgB');
  await page.getByTestId('genome-search-next').click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => /^ctgB:4,9\d\d\.\.5,0\d\d/.test(i.value)), null, { timeout: 30_000 });
  assert.match(await position(), /Match 5 of 6: ctgB:5,001-5,020/);
  const afterNext = await locationText();
  await page.getByTestId('genome-search-previous').click();
  await page.getByTestId('genome-search-previous').click();
  await page.getByTestId('genome-search-previous').click();
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(i => /^ctgA:999,9\d\d\.\.1,000,0\d\d/.test(i.value)), null, { timeout: 30_000 });
  assert.match(await position(), /Match 2 of 6: ctgA:999,991-1,000,010/);
  await screenshot('desktop-navigated-chunk-boundary');
  return { afterNext, afterPrevious: await locationText() };
});

await check('results track saved by Desktop holds the same hits as the list', async () => {
  await app.page.waitForTimeout(3000); // let Desktop autosave
  const saved = await findSavedResults();
  assert.ok(saved, 'no saved session with search results found');
  const decoded = decodeResults(saved.track.adapter.results);
  assert.deepEqual(decoded.hits.map(({ refName, start, end, strand }) => ({ refName, start, end, strand })), EXPECTED);
  return { savedIn: saved.file.replace(out, '<output>'), plugins: saved.plugins };
});

await check('results remain after quitting and reopening the session', async () => {
  const saved = await findSavedResults();
  await quit(app);
  app = await launch(saved.file);
  await viewReady();
  await app.page.getByText('Tools', { exact: true }).click();
  await app.page.getByRole('menuitem', { name: 'Search genome…' }).click();
  await app.page.getByTestId('genome-search-row').first().waitFor({ timeout: 30_000 });
  assert.equal(await app.page.getByTestId('genome-search-row').count(), 6);
  await screenshot('desktop-reopened');
});

await check('a file:// plugin URL is rejected by Desktop', async () => {
  await quit(app);
  app = await launch(filePluginSession);
  await app.page.getByText(/cannot load plugins using protocol "file:"/i).first().waitFor({ timeout: 60_000 });
  await screenshot('desktop-file-url-rejected');
  return { message: await app.page.getByText(/cannot load plugins using protocol/i).first().innerText() };
});

await quit(app);
server.close();
const report = {
  jbrowse: `JBrowse Desktop ${version} (Linux build run under Xvfb)`,
  plugin: `${pkg.name} ${pkg.version}`,
  pluginUrl: pluginPath,
  sourceCommit: process.env.SOURCE_COMMIT || 'unknown',
  sourceDirty: process.env.SOURCE_DIRTY || 'unknown',
  date: new Date().toISOString(),
  passed: checks.filter(c => c.ok).length,
  failed: checks.filter(c => !c.ok).length,
  checks,
};
await writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.passed} passed, ${report.failed} failed`);
process.exit(report.failed ? 1 : 0);
