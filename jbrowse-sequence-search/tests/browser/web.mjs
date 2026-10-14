// End-to-end check of the BUILT plugin inside a real JBrowse Web release.
// Run with Node and an existing Playwright installation. Required:
//   PLAYWRIGHT_MODULE=/abs/path/to/playwright/index.mjs
//   BROWSER_EXECUTABLE=/abs/path/to/chrome
//   JBROWSE_WEB_DIR=/abs/path/to/unzipped/jbrowse-web-v4.3.0
//   TEST_OUTPUT_DIR=/abs/path/for/screenshots/and/report
// Optional: PLUGIN_DIST_DIR (default ../../dist). The script generates the
// test genomes, serves JBrowse, the plugin and the data from one local
// origin (as a self-hosted deployment would), and writes report.json.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPECTED, QUERY, assemblyConfig, buildGenomes, serve, writeFasta } from './fixture.mjs';
import { bruteForce } from '../helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const jbrowseDir = resolve(process.env.JBROWSE_WEB_DIR);
const distDir = resolve(process.env.PLUGIN_DIST_DIR || join(here, '../../dist'));
const out = resolve(process.env.TEST_OUTPUT_DIR);
const pkg = JSON.parse(await readFile(join(here, '../../package.json'), 'utf8'));
const pluginPath = `/plugins/jbrowse-sequence-search/${pkg.version}/jbrowse-sequence-search.js`;
await mkdir(join(out, 'data'), { recursive: true });

const genomes = buildGenomes();
await writeFasta(join(out, 'data'), 'testgenome', genomes.testgenome);
await writeFasta(join(out, 'data'), 'othergenome', genomes.othergenome);
await writeFasta(join(out, 'data'), 'slowgenome', genomes.slowgenome);
const jbrowseVersion = (await readFile(join(jbrowseDir, 'version.txt'), 'utf8')).trim();
const config = {
  // Root-relative URL on the same server that hosts JBrowse.
  plugins: [{ name: 'GenomeSequenceSearch', url: pluginPath }],
  configuration: { disableAnalytics: true },
  assemblies: ['testgenome', 'othergenome', 'slowgenome'].map(name => assemblyConfig(name, '/data')),
  tracks: [],
  defaultSession: {
    name: 'Genome search test',
    views: [
      { id: 'viewTest', type: 'LinearGenomeView', init: { assembly: 'testgenome', loc: 'ctgA:1-5000', tracks: ['testgenome-reference'] } },
      { id: 'viewOther', type: 'LinearGenomeView', init: { assembly: 'othergenome', loc: 'otherChr:1-2000' } },
    ],
  },
};
await writeFile(join(out, 'config.json'), JSON.stringify(config, null, 2));

let slow = 0;
const requests = [];
const { server, origin } = await serve({
  '/plugins/': distDir, '/data/': join(out, 'data'), '/cfg/': out, '/jbrowse/': jbrowseDir,
}, requests, { delay: path => (path === '/data/slowgenome.fa' ? slow : 0) });

const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const checks = [];
let shot = 0;
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    checks.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
    console.log(`ok - ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, error: String(e?.stack || e) });
    console.log(`not ok - ${name}\n${e?.stack || e}`);
    await page.screenshot({ path: join(out, `failure-${checks.length}.png`) }).catch(() => {});
  }
}
async function screenshot(label) {
  shot += 1;
  await page.screenshot({ path: join(out, `${String(shot).padStart(2, '0')}-${label}.png`) });
}

const testId = id => page.getByTestId(id);
const outcome = () => testId('genome-search-outcome');
async function runSearch(query, { ambiguity = false, strand } = {}) {
  await testId('genome-search-query').fill(query);
  const box = page.getByLabel('Allow ambiguity codes');
  if ((await box.isChecked()) !== ambiguity) await box.click();
  if (strand) await page.getByLabel(strand, { exact: true }).check();
  await testId('genome-search-submit').click();
  await testId('genome-search-progress').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(q => {
    const w = window.JBrowseSession.widgets.get('genomeSequenceSearch');
    const r = w?.results ?? w?.emptyOutcome;
    return !w.running && r && r.query === q;
  }, query.toUpperCase().replace(/\s+/g, ''), { timeout: 60_000 });
}
const widgetState = () => page.evaluate(() => {
  const w = window.JBrowseSession.widgets.get('genomeSequenceSearch');
  const r = w.results ?? w.emptyOutcome;
  return {
    status: r?.status, count: r?.count, assemblyName: r?.assemblyName, selectedIndex: w.selectedIndex,
    trackId: w.resultTrackId,
    hits: r?.hits?.map(({ refName, start, end, strand, matched }) => ({ refName, start, end, strand, matched })),
  };
});
const viewState = viewId => page.evaluate(id => {
  const v = window.JBrowseSession.views.find(x => x.id === id);
  const left = v.pxToBp(0);
  const right = v.pxToBp(v.width);
  return {
    refNames: v.displayedRegions.map(r => r.refName), left: { refName: left.refName, coord: left.coord },
    right: { refName: right.refName, coord: right.coord }, tracks: v.tracks.map(t => t.configuration.trackId),
  };
}, viewId);
const strip = hits => hits.map(({ refName, start, end, strand }) => ({ refName, start, end, strand }));

await page.goto(`${origin}/jbrowse/?config=/cfg/config.json`);
await page.waitForFunction(() => window.JBrowseSession?.views?.[0]?.initialized, null, { timeout: 60_000 });

await check('plugin loads from the self-hosted URL on the page and in the RPC worker', async () => {
  await page.waitForTimeout(1500);
  const names = await page.evaluate(() => window.JBrowseRootModel.jbrowse.plugins.map(p => p.name));
  assert.deepEqual(names, ['GenomeSequenceSearch']);
  const fetched = requests.filter(p => p === pluginPath).length;
  assert.ok(fetched >= 2, `plugin fetched ${fetched} times`);
  return { pluginUrl: `${origin}${pluginPath}`, fetched, jbrowseVersion };
});

await check('Tools menu opens the search panel with the whole-assembly scope', async () => {
  await screenshot('initial-view-ctgA-1-5000');
  await page.getByText('Tools', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Search genome…' }).click();
  await testId('genome-search-widget').waitFor();
  const scope = await testId('genome-search-scope').innerText();
  assert.match(scope, /all 3 sequences of testgenome \(2\.20 Mb\), both strands/);
  return { scope };
});

await check('invalid input is explained and cannot be searched', async () => {
  const cases = {
    GANTC: /ambiguity code “N”/, ACGU: /uracil/, 'GA.TC': /regular-expression/, 'ACGTX': /not DNA letters/,
  };
  for (const [text, re] of Object.entries(cases)) {
    await testId('genome-search-query').fill(text);
    await page.getByText(re).waitFor();
    assert.equal(await testId('genome-search-submit').isDisabled(), true, text);
  }
  await testId('genome-search-query').fill('>oligo 1\n1 acgttgcatg cagtcctagg\n');
  await page.getByText('Ignored the FASTA header line. Ignored spaces, line breaks and numbers.').waitFor();
});

let firstTrackId;
await check('search finds every planted hit, beyond the visible region and on other contigs', async () => {
  await runSearch(QUERY);
  await screenshot('results-complete');
  const state = await widgetState();
  assert.equal(state.status, 'complete');
  assert.deepEqual(strip(state.hits), EXPECTED);
  assert.ok(state.hits.every(h => h.matched === QUERY));
  assert.match(await outcome().innerText(), /Found 6 matches\. Searched all 3 sequences of testgenome/);
  const rows = await testId('genome-search-row').allInnerTexts();
  assert.equal(rows.length, 6);
  assert.match(rows[2].replace(/\s+/g, ' '), /^3 ctgA 2,099,981 2,100,000 − ACGTTGCATGCAGTCCTAGG$/);
  firstTrackId = state.trackId;
  const view = await viewState('viewTest');
  assert.ok(view.tracks.includes(firstTrackId), 'results track shown in the originating view');
  return { rows: rows.map(r => r.replace(/\s+/g, ' ')) };
});

await check('results track and list are the same result set (worker reads the track adapter)', async () => {
  const fromTrack = await page.evaluate(async trackId => {
    const session = window.JBrowseSession;
    const conf = session.tracks.find(t => t.trackId === trackId);
    const adapterConfig = JSON.parse(JSON.stringify(conf.adapter));
    const asm = session.assemblyManager.get('testgenome');
    const all = [];
    for (const r of asm.regions) {
      const feats = await session.rpcManager.call('e2e-check', 'CoreGetFeatures', {
        sessionId: 'e2e-check', adapterConfig, regions: [{ refName: r.refName, start: r.start, end: r.end, assemblyName: 'testgenome' }],
      });
      all.push(...feats.map(f => f.toJSON()).map(f => ({ refName: f.refName, start: f.start, end: f.end, strand: f.strand, id: f.uniqueId })));
    }
    return all;
  }, firstTrackId);
  assert.deepEqual(strip(fromTrack), EXPECTED);
  assert.deepEqual(fromTrack.map(f => f.id), EXPECTED.map((_, i) => `genome-search-${i}`));
  return { featuresFromWorker: fromTrack.length };
});

async function selectedRendered(index) {
  await page.waitForFunction(({ trackId, id }) => {
    const v = window.JBrowseSession.views.find(x => x.id === 'viewTest');
    const track = v.tracks.find(t => t.configuration.trackId === trackId);
    // The display's layout holds the features of its rendered blocks.
    return Boolean(track?.displays?.[0]?.searchFeatureByID?.(id));
  }, { trackId: firstTrackId, id: `genome-search-${index}` }, { timeout: 30_000 });
}

await check('clicking a result navigates to it with flanking sequence and the track shows it', async () => {
  await testId('genome-search-row').nth(3).click(); // ctgB:1-20, soft-masked, contig start
  await page.waitForFunction(() => window.JBrowseSession.views[0].displayedRegions[0]?.refName === 'ctgB');
  await selectedRendered(3);
  const view = await viewState('viewTest');
  assert.deepEqual(view.refNames, ['ctgB']);
  assert.ok(view.left.coord <= 1 && view.right.coord >= 20 && view.right.coord <= 120, JSON.stringify(view));
  assert.match(await testId('genome-search-position').innerText(), /Match 4 of 6: ctgB:1-20/);
  await screenshot('navigated-ctgB-1');
  return view;
});

await check('Next and Previous step through matches in genome order', async () => {
  await testId('genome-search-next').click();
  await page.waitForFunction(() => {
    const v = window.JBrowseSession.views[0];
    return v.pxToBp(0).coord > 4900 && v.pxToBp(0).refName === 'ctgB';
  });
  await selectedRendered(4);
  assert.match(await testId('genome-search-position').innerText(), /Match 5 of 6: ctgB:5,001-5,020/);
  await testId('genome-search-next').click();
  await page.waitForFunction(() => window.JBrowseSession.views[0].displayedRegions[0]?.refName === 'ctgC');
  assert.equal(await testId('genome-search-next').isDisabled(), true, 'Next disabled at the last match');
  await testId('genome-search-previous').click();
  await testId('genome-search-previous').click();
  await page.waitForFunction(() => window.JBrowseSession.views[0].pxToBp(0).refName === 'ctgB' && window.JBrowseSession.views[0].pxToBp(0).coord < 10);
  assert.match(await testId('genome-search-position').innerText(), /Match 4 of 6/);
  // Crossing back onto ctgA, to the hit spanning the chunk boundary.
  await testId('genome-search-previous').click();
  await testId('genome-search-previous').click();
  await page.waitForFunction(() => {
    const v = window.JBrowseSession.views[0];
    return v.pxToBp(0).refName === 'ctgA' && v.pxToBp(0).coord < 999_991 && v.pxToBp(v.width).coord > 1_000_010;
  });
  await selectedRendered(1);
  assert.match(await testId('genome-search-position').innerText(), /Match 2 of 6: ctgA:999,991-1,000,010/);
  await screenshot('navigated-chunk-boundary-hit');
});

await check('lowercase query matches soft-masked sequence identically', async () => {
  await runSearch(QUERY.toLowerCase());
  const state = await widgetState();
  assert.deepEqual(strip(state.hits), EXPECTED);
});

await check('palindromic query: one hit per site, strand both, equal to brute force over the genome', async () => {
  await runSearch('GAATTC');
  const state = await widgetState();
  const expected = bruteForce(genomes.testgenome, 'GAATTC');
  assert.equal(state.status, 'complete');
  assert.ok(expected.length > 100);
  assert.deepEqual(strip(state.hits), expected);
  assert.ok(state.hits.every(h => h.strand === 0));
  assert.match(await outcome().innerText(), /its own reverse complement/);
  return { hits: state.hits.length };
});

await check('forward-only search reports only + strand matches', async () => {
  await runSearch(QUERY, { strand: 'Forward (+)' });
  const state = await widgetState();
  assert.deepEqual(strip(state.hits), EXPECTED.filter(h => h.strand === 1));
  await page.getByLabel('Both', { exact: true }).check();
});

await check('IUPAC ambiguity search equals brute force and lists matched bases', async () => {
  await runSearch('GGATCNNR', { ambiguity: true });
  const state = await widgetState();
  const expected = bruteForce(genomes.testgenome, 'GGATCNNR');
  assert.equal(state.status, 'complete');
  assert.deepEqual(strip(state.hits), expected);
  assert.ok(state.hits.every(h => /^[ACGT]{8}$/.test(h.matched)));
  return { hits: state.hits.length };
});

await check('no matches is reported as a complete search', async () => {
  await runSearch('ACGTTGCATGCAGTCCTAGGACGTTGCATGCAG');
  const state = await widgetState();
  assert.equal(state.status, 'complete');
  assert.equal(state.count, 0);
  assert.match(await outcome().innerText(), /No matches\. Searched all 3 sequences of testgenome/);
  await screenshot('no-matches');
});

await check('a result limit is labelled incomplete and the long list stays usable', async () => {
  await runSearch('AC');
  const state = await widgetState();
  assert.equal(state.status, 'limit');
  assert.equal(state.count, 10_000);
  assert.match(await outcome().innerText(), /Incomplete: stopped at the limit of 10,000 matches/);
  const rendered = await testId('genome-search-row').count();
  assert.ok(rendered < 60, `${rendered} rows rendered`);
  await testId('genome-search-results').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.locator('[data-testid=genome-search-row][data-index="9999"]').waitFor();
  const t0 = Date.now();
  await page.locator('[data-testid=genome-search-row][data-index="9999"]').click();
  await page.waitForFunction(() => window.JBrowseSession.widgets.get('genomeSequenceSearch').selectedIndex === 9999);
  await screenshot('limit-reached');
  return { rendered, selectLastMs: Date.now() - t0 };
});

async function chooseAssembly(name) {
  await page.getByRole('combobox', { name: 'Assembly' }).click();
  await page.getByRole('option', { name }).click();
  await page.waitForFunction(n => window.JBrowseSession.widgets.get('genomeSequenceSearch').assemblyName === n, name);
}

await check('Stop cancels the search, stops further reads and is labelled incomplete', async () => {
  slow = 700;
  await chooseAssembly('slowgenome');
  await testId('genome-search-query').fill(QUERY);
  await testId('genome-search-submit').click();
  await testId('genome-search-stop').waitFor();
  await page.waitForTimeout(900);
  await testId('genome-search-stop').click();
  await page.waitForFunction(() => !window.JBrowseSession.widgets.get('genomeSequenceSearch').running, null, { timeout: 30_000 });
  const readsAtStop = requests.filter(p => p === '/data/slowgenome.fa').length;
  await page.waitForTimeout(3000);
  const readsLater = requests.filter(p => p === '/data/slowgenome.fa').length;
  slow = 0;
  const state = await widgetState();
  assert.equal(state.status, 'cancelled');
  assert.match(await outcome().innerText(), /Incomplete: search stopped/);
  assert.equal(readsLater, readsAtStop, 'no sequence reads after stopping');
  await screenshot('cancelled');
  return { status: state.status, hitsBeforeStop: state.count, readsAtStop, readsLater };
});

await check('starting a replacement search discards the superseded one', async () => {
  slow = 500;
  const tracksBefore = await page.evaluate(() => window.JBrowseSession.tracks.length);
  await testId('genome-search-query').fill(QUERY);
  await testId('genome-search-submit').click();
  await testId('genome-search-stop').waitFor();
  await page.waitForTimeout(600);
  await testId('genome-search-query').fill('GAATTC');
  await testId('genome-search-submit').click(); // "Restart search"
  await page.waitForFunction(() => {
    const w = window.JBrowseSession.widgets.get('genomeSequenceSearch');
    return !w.running && w.results?.query === 'GAATTC';
  }, null, { timeout: 60_000 });
  slow = 0;
  await page.waitForTimeout(1500);
  const state = await widgetState();
  const tracksAfter = await page.evaluate(() => window.JBrowseSession.tracks.length);
  assert.equal(state.status, 'complete');
  assert.equal(state.assemblyName, 'slowgenome');
  assert.deepEqual(strip(state.hits), bruteForce(genomes.slowgenome, 'GAATTC'));
  assert.equal(tracksAfter, tracksBefore + 1, 'only the replacement search created a track');
  return { hits: state.hits.length };
});

await check('assembly follows the view the command is opened from', async () => {
  await page.getByTestId('view_menu_icon').nth(1).click();
  await page.getByText('Whole assembly, with a results list').click();
  await page.waitForFunction(() => window.JBrowseSession.widgets.get('genomeSequenceSearch').assemblyName === 'othergenome');
  assert.match(await testId('genome-search-scope').innerText(), /all 1 sequences of othergenome/);
  await runSearch(QUERY);
  const state = await widgetState();
  assert.equal(state.assemblyName, 'othergenome');
  assert.deepEqual(strip(state.hits), [{ refName: 'otherChr', start: 42, end: 62, strand: 1 }]);
  const conf = await page.evaluate(id => JSON.parse(JSON.stringify(window.JBrowseSession.tracks.find(t => t.trackId === id))).assemblyNames, state.trackId);
  assert.deepEqual(conf, ['othergenome']);
  await testId('genome-search-row').first().click();
  await page.waitForFunction(() => window.JBrowseSession.views.find(v => v.id === 'viewOther').pxToBp(0).coord < 43);
  const other = await viewState('viewOther');
  assert.ok(other.tracks.includes(state.trackId));
  const test = await viewState('viewTest');
  assert.ok(!test.tracks.includes(state.trackId), 'not shown in the testgenome view');
  await screenshot('other-assembly');
});

await check('results survive a page reload (session restore) and still navigate', async () => {
  const before = await widgetState();
  await page.reload();
  await page.waitForFunction(() => window.JBrowseSession?.views?.[0]?.initialized, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.JBrowseSession.widgets.get('genomeSequenceSearch')?.results?.hits);
  const after = await widgetState();
  assert.deepEqual(after.hits, before.hits);
  assert.equal(after.trackId, before.trackId);
  await testId('genome-search-row').first().waitFor();
  const sessionChars = await page.evaluate(() => sessionStorage.getItem('current')?.length);
  return { restoredHits: after.hits.length, sessionStorageChars: sessionChars };
});

await check('no uncaught page errors', async () => {
  assert.deepEqual(pageErrors, []);
});

await browser.close();
server.close();
const report = {
  jbrowse: `JBrowse Web ${jbrowseVersion}`,
  browser: browser.version?.() ?? 'chromium',
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
