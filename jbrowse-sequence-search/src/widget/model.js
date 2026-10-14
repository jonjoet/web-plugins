import { types, isAlive } from 'mobx-state-tree';
import { readConfObject } from '@jbrowse/core/configuration';
import { createStopToken, getSession, stopStopToken } from '@jbrowse/core/util';
import { ElementId } from '@jbrowse/core/util/types/mst';
import { parseQuery } from '../search/query.js';
import { planChunks, totalBases } from '../search/chunks.js';
import { DEFAULT_CONCURRENCY, DEFAULT_MAX_HITS, runSearch } from '../search/run.js';
import { createCoordinator } from '../search/coordinator.js';
import { decodeResults, encodeResults, stepIndex } from '../search/results.js';
import { SCAN_METHOD } from '../jbrowse/ScanChunk.js';
import {
  WIDGET_TYPE, addResultsTrack, findTrackConf, hideTrackInViews, loadAssembly, resultsView, showHit, showTrackIn,
} from '../jbrowse/session.js';

// All sequence reads for searches share one RPC session id, so they go to one
// worker and reuse one cached sequence adapter per assembly configuration.
const RPC_SESSION_ID = 'GenomeSequenceSearch';
const PROGRESS_INTERVAL_MS = 150;

export default function stateModelFactory() {
  return types
    .model(WIDGET_TYPE, {
      id: ElementId,
      type: types.literal(WIDGET_TYPE),
      // Persisted with the session: the form and a reference to the results
      // track. Hits themselves live only in that track's configuration.
      viewId: types.maybe(types.string),
      assemblyName: types.maybe(types.string),
      queryText: '',
      strandMode: types.optional(types.enumeration(['both', 'forward', 'reverse']), 'both'),
      allowAmbiguity: false,
      resultTrackId: types.maybe(types.string),
      // Outcome of the last search when it produced no track (no hits).
      emptyOutcome: types.frozen(),
      selectedIndex: -1,
    })
    .volatile(() => ({
      running: false,
      runningSearch: undefined,
      progress: undefined,
      runError: undefined,
      navigationError: undefined,
      coordinator: createCoordinator(),
    }))
    .views(self => ({
      get parsed() {
        return parseQuery(self.queryText, { allowAmbiguity: self.allowAmbiguity });
      },
      get resultTrackConf() {
        return findTrackConf(getSession(self), self.resultTrackId);
      },
      // Decoded once per stored value (MobX caches the getter while observed).
      get results() {
        const conf = self.resultTrackConf;
        if (!conf) return undefined;
        try {
          return decodeResults(readConfObject(conf, ['adapter', 'results']));
        } catch (e) {
          return { error: e };
        }
      },
      get resultTrackName() {
        const conf = self.resultTrackConf;
        return conf ? readConfObject(conf, 'name') : undefined;
      },
      get resultsMissing() {
        return self.resultTrackId !== undefined && !self.resultTrackConf;
      },
    }))
    .actions(self => ({
      setTarget(viewId, assemblyName) {
        self.viewId = viewId;
        if (assemblyName) self.assemblyName = assemblyName;
      },
      setAssemblyName(name) {
        self.assemblyName = name;
      },
      setQueryText(text) {
        self.queryText = text;
      },
      setStrandMode(mode) {
        self.strandMode = mode;
      },
      setAllowAmbiguity(flag) {
        self.allowAmbiguity = flag;
      },
      setSelectedIndex(index) {
        self.selectedIndex = index;
      },
      setNavigationError(error) {
        self.navigationError = error;
      },
      begin(search) {
        self.running = true;
        self.runningSearch = search;
        self.runError = undefined;
        self.navigationError = undefined;
        self.progress = { scannedBases: 0, totalBases: search.totalBases, hits: 0 };
      },
      setProgress(progress) {
        if (self.running) self.progress = progress;
      },
      end() {
        self.running = false;
        self.runningSearch = undefined;
        self.progress = undefined;
      },
      fail(error) {
        self.runError = String(error?.message || error);
      },
      publish(trackId, emptyOutcome) {
        self.resultTrackId = trackId;
        self.emptyOutcome = emptyOutcome;
        self.selectedIndex = -1;
      },
      cancel() {
        self.coordinator.cancel();
      },
    }))
    .actions(self => ({
      async search() {
        const parsed = self.parsed;
        const assemblyName = self.assemblyName;
        // Starting while a search runs replaces it: the coordinator aborts the
        // old search and discards its results when they arrive.
        if (!parsed.ok || !assemblyName) return;
        const session = getSession(self);
        const { rpcManager } = session;
        const { strandMode, allowAmbiguity } = self;
        self.begin({ assemblyName, query: parsed.sequence, strandMode, totalBases: 0 });

        const { promise } = self.coordinator.start(async signal => {
          const { regions, adapterConfig } = await loadAssembly(session, assemblyName);
          const search = {
            assemblyName,
            query: parsed.sequence,
            strandMode,
            ambiguous: parsed.ambiguous,
            allowAmbiguity,
            palindromic: parsed.palindromic,
            regionCount: regions.length,
            totalBases: totalBases(regions),
            maxHits: DEFAULT_MAX_HITS,
          };
          // If stopped or replaced while the assembly loaded, the runner below
          // returns "cancelled" at once; do not touch a newer search's state.
          if (!signal.aborted) self.begin(search);
          let lastProgress = 0;
          const outcome = await runSearch({
            chunks: planChunks(regions, { queryLength: parsed.length }),
            queryLength: parsed.length,
            totalBases: search.totalBases,
            maxHits: search.maxHits,
            concurrency: DEFAULT_CONCURRENCY,
            signal,
            onProgress: progress => {
              const now = Date.now();
              if (now - lastProgress >= PROGRESS_INTERVAL_MS || progress.scannedBases === progress.totalBases) {
                lastProgress = now;
                if (isAlive(self) && !signal.aborted) self.setProgress(progress);
              }
            },
            scanChunk: async chunk => {
              const stopToken = createStopToken();
              const stop = () => stopStopToken(stopToken);
              signal.addEventListener('abort', stop, { once: true });
              try {
                return await rpcManager.call(RPC_SESSION_ID, SCAN_METHOD, {
                  sessionId: RPC_SESSION_ID,
                  adapterConfig,
                  chunk,
                  query: parsed.sequence,
                  strandMode,
                  withMatched: parsed.ambiguous,
                  limit: search.maxHits + 1,
                  stopToken,
                });
              } finally {
                signal.removeEventListener('abort', stop);
                stopStopToken(stopToken);
              }
            },
          });
          return { search, outcome, regions };
        });

        const settled = await promise;
        if (settled.stale || !isAlive(self)) return;
        self.end();
        if (settled.error) {
          self.fail(settled.error);
          return;
        }
        const { search, outcome } = settled.result;
        const stored = encodeResults({ search, outcome, createdAt: new Date().toISOString() });
        if (outcome.hits.length === 0) {
          // Keep the summary (no hits to show), but no track.
          const { hits: _hits, refNames: _r, seqs: _s, ...summary } = stored;
          if (self.resultTrackId) hideTrackInViews(session, self.resultTrackId);
          self.publish(undefined, summary);
          return;
        }
        try {
          const previous = self.resultTrackId;
          const trackId = addResultsTrack(session, stored);
          self.publish(trackId, undefined);
          // The panel shows only the latest results; hide the superseded
          // track (it stays in the track selector).
          if (previous) hideTrackInViews(session, previous);
          const view = resultsView(session, self.viewId, assemblyName);
          if (view) showTrackIn(view, trackId);
        } catch (e) {
          self.fail(e);
        }
      },

      async select(index) {
        const results = self.results;
        if (!results?.hits?.[index]) return;
        self.setSelectedIndex(index);
        self.setNavigationError(undefined);
        const session = getSession(self);
        try {
          const { regions } = await loadAssembly(session, results.assemblyName);
          const view = await showHit(session, {
            viewId: self.viewId,
            assemblyName: results.assemblyName,
            trackId: self.resultTrackId,
            hit: results.hits[index],
            regions,
          });
          if (isAlive(self) && view && view.id !== self.viewId) self.setTarget(view.id);
        } catch (e) {
          if (isAlive(self)) self.setNavigationError(String(e?.message || e));
        }
      },

      step(delta) {
        const count = self.results?.hits?.length ?? 0;
        const index = stepIndex(self.selectedIndex, count, delta);
        if (index >= 0) return self.select(index);
        return undefined;
      },

      beforeDestroy() {
        self.coordinator.cancel();
      },
    }));
}

