import { RpcMethodType } from '@jbrowse/core/pluggableElementTypes';
import { checkStopToken } from '@jbrowse/core/util';
import { scanText } from '../search/scan.js';

export const SCAN_METHOD = 'GenomeSequenceSearchScanChunk';

// Runs in the JBrowse RPC worker (off the UI thread with the default
// WebWorkerRpcDriver). Reads one bounded chunk of one contig through the
// core CoreGetSequence RPC method, which uses JBrowse's own adapter cache and
// the assembly's configured sequence adapter, then scans it.
export default class ScanChunk extends RpcMethodType {
  name = SCAN_METHOD;

  async execute(args, rpcDriverClassName) {
    const deserialized = await this.deserializeArguments(args, rpcDriverClassName);
    const { sessionId, adapterConfig, chunk, query, strandMode, withMatched, limit, stopToken } = deserialized;
    const getSequence = this.pluginManager.getRpcMethodType('CoreGetSequence');
    if (!getSequence) throw new Error('This JBrowse version does not provide sequence access (CoreGetSequence).');
    const region = { refName: chunk.refName, start: chunk.fetchStart, end: chunk.fetchEnd };
    const sequence = await getSequence.execute({ ...deserialized, sessionId, adapterConfig, region, stopToken }, rpcDriverClassName);
    const expected = chunk.fetchEnd - chunk.fetchStart;
    if (typeof sequence !== 'string' || sequence.length !== expected) {
      const got = typeof sequence === 'string' ? sequence.length : 0;
      throw new Error(`Could not read ${chunk.refName}:${chunk.fetchStart + 1}-${chunk.fetchEnd} (received ${got} of ${expected} bases).`);
    }
    checkStopToken(stopToken);
    return scanText(sequence, chunk.fetchStart, query, strandMode, chunk.start, chunk.end, withMatched, limit);
  }
}
