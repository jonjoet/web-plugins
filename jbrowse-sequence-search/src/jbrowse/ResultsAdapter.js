import { ConfigurationSchema } from '@jbrowse/core/configuration';
import { BaseFeatureDataAdapter } from '@jbrowse/core/data_adapters/BaseAdapter';
import { SimpleFeature } from '@jbrowse/core/util';
import { ObservableCreate } from '@jbrowse/core/util/rxjs';
import { decodeResults } from '../search/results.js';
import { strandLabel } from '../search/format.js';

export const ADAPTER_TYPE = 'GenomeSequenceSearchResultsAdapter';

export const adapterConfigSchema = ConfigurationSchema(ADAPTER_TYPE, {
  results: {
    type: 'frozen',
    defaultValue: null,
    description: 'Stored genome search results (written by the Search genome command)',
  },
}, { explicitlyTyped: true });

// Serves the hits stored in its own configuration. The results list decodes
// the same configuration value, so the track and the list cannot disagree.
export class ResultsAdapter extends BaseFeatureDataAdapter {
  byRef() {
    if (!this.cache) {
      const results = decodeResults(this.getConf('results'));
      const byRef = new Map();
      for (const hit of results.hits) {
        if (!byRef.has(hit.refName)) byRef.set(hit.refName, []);
        byRef.get(hit.refName).push(hit);
      }
      this.cache = { results, byRef };
    }
    return this.cache;
  }

  async getRefNames() {
    return [...this.byRef().byRef.keys()];
  }

  getFeatures(region) {
    return ObservableCreate(async observer => {
      const { results, byRef } = this.byRef();
      const hits = byRef.get(region.refName) || [];
      // Hits are sorted by start and share one length, so ends are sorted too.
      let lo = 0;
      let hi = hits.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (hits[mid].end <= region.start) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < hits.length && hits[i].start < region.end; i++) {
        const hit = hits[i];
        observer.next(new SimpleFeature({
          uniqueId: `genome-search-${hit.index}`,
          refName: hit.refName,
          start: hit.start,
          end: hit.end,
          strand: hit.strand,
          type: 'sequence_match',
          name: `Match ${hit.index + 1}`,
          description: `${strandLabel(hit.strand)} strand, ${results.query}`,
          matched_sequence: hit.matched,
          match_number: `${hit.index + 1} of ${results.count}`,
        }));
      }
      observer.complete();
    });
  }

  freeResources() {}
}
