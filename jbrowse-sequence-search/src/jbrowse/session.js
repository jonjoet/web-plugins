import { getSnapshot } from 'mobx-state-tree';
import { isSessionModelWithWidgets, isSessionWithAddTracks } from '@jbrowse/core/util';
import { pickAssembly } from '../search/assembly.js';
import { formatLocation, navigationWindow } from '../search/format.js';
import { ADAPTER_TYPE } from './ResultsAdapter.js';

export const WIDGET_TYPE = 'GenomeSequenceSearchWidget';
export const WIDGET_ID = 'genomeSequenceSearch';
export const TRACK_CATEGORY = 'Genome search results';

export function isLinearGenomeView(view) {
  return view?.type === 'LinearGenomeView';
}

export function sessionAssemblyNames(session) {
  const names = session.assemblyNames
    ?? session.assemblyManager?.assemblyNamesList
    ?? [];
  return [...names];
}

// Opens (or reuses) the search panel. `view` is the view the command was
// chosen from, if any; it decides the default assembly and where results
// are shown.
export function openSearchWidget(session, view) {
  if (!isSessionModelWithWidgets(session)) {
    session.notify?.('Search genome needs JBrowse Web or Desktop.', 'warning');
    return undefined;
  }
  const views = session.views.filter(isLinearGenomeView);
  const focused = views.find(v => v.id === session.focusedViewId);
  const origin = isLinearGenomeView(view) ? view : focused ?? views[0];
  let widget = session.widgets.get(WIDGET_ID);
  if (!widget) {
    widget = session.addWidget(WIDGET_TYPE, WIDGET_ID);
  }
  if (!widget.running) {
    const preferred = [origin?.assemblyNames?.[0], widget.assemblyName, ...views.map(v => v.assemblyNames?.[0])];
    widget.setTarget(origin?.id, pickAssembly(sessionAssemblyNames(session), preferred));
  }
  session.showWidget(widget);
  return widget;
}

export async function loadAssembly(session, assemblyName) {
  const assembly = await session.assemblyManager.waitForAssembly(assemblyName);
  if (!assembly) throw new Error(`Assembly ${assemblyName} is not available.`);
  if (assembly.error) throw new Error(`Assembly ${assemblyName} could not be loaded: ${assembly.error}`);
  const regions = assembly.regions;
  if (!regions?.length) throw new Error(`Assembly ${assemblyName} has no sequences.`);
  return {
    regions: regions.map(({ refName, start, end }) => ({ refName, start, end })),
    adapterConfig: getSnapshot(assembly.configuration.sequence.adapter),
  };
}

function shortQuery(query) {
  return query.length > 24 ? `${query.slice(0, 20)}… (${query.length} bp)` : query;
}

export function trackName(stored) {
  const suffix = stored.status === 'complete' ? '' : ' (incomplete)';
  return `Search: ${shortQuery(stored.query)} in ${stored.assemblyName}${suffix}`;
}

export function addResultsTrack(session, stored) {
  if (!isSessionWithAddTracks(session)) {
    throw new Error('This session does not allow adding tracks, so results cannot be shown as a track.');
  }
  const trackId = `genome-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  session.addTrackConf({
    type: 'FeatureTrack',
    trackId,
    name: trackName(stored),
    assemblyNames: [stored.assemblyName],
    category: [TRACK_CATEGORY],
    adapter: { type: ADAPTER_TYPE, results: stored },
  });
  return trackId;
}

export function findTrackConf(session, trackId) {
  return trackId ? session.tracks.find(t => t.trackId === trackId) : undefined;
}

// The view results open in: the remembered view if it still shows the
// assembly, else any view of that assembly, else a new view.
export function resultsView(session, viewId, assemblyName) {
  const views = session.views.filter(isLinearGenomeView);
  const sameAssembly = v => v.assemblyNames?.[0] === assemblyName;
  return views.find(v => v.id === viewId && sameAssembly(v)) ?? views.find(sameAssembly);
}

export async function showHit(session, { viewId, assemblyName, trackId, hit, regions }) {
  const region = regions.find(r => r.refName === hit.refName);
  if (!region) throw new Error(`${hit.refName} is not part of ${assemblyName}.`);
  const { start, end } = navigationWindow(hit, region.start, region.end);
  let view = resultsView(session, viewId, assemblyName);
  if (!view) {
    view = session.addView('LinearGenomeView', {
      init: { assembly: assemblyName, loc: formatLocation(hit.refName, start, end).replace(/,/g, ''), tracks: [trackId] },
    });
    return view;
  }
  await view.navToLocations([{ refName: hit.refName, start, end, assemblyName }], assemblyName);
  showTrackIn(view, trackId);
  return view;
}

export function showTrackIn(view, trackId) {
  if (trackId && !view.tracks.some(t => t.configuration.trackId === trackId)) {
    view.showTrack(trackId);
  }
}

export function hideTrackInViews(session, trackId) {
  for (const view of session.views.filter(isLinearGenomeView)) {
    if (view.tracks.some(t => t.configuration.trackId === trackId)) view.hideTrack(trackId);
  }
}
