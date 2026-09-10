export class ApiError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// No arbitrary URLs or methods are exposed; all requests are GETs to Trello.
// Keep one instance for repeated probes, so pacing survives refresh/cancellation.
export function createApi({ appKey, token, fetchImpl = fetch, now = Date.now,
  wait = sleep, random = Math.random, timeoutMs = 20000 }) {
  let nextStart = 0;
  async function get(path, parameters, signal) {
    for (let attempt = 0; attempt <= 3; attempt++) {
      signal?.throwIfAborted();
      const start = Math.max(now(), nextStart);
      nextStart = start + 210;
      await wait(Math.max(0, start - now()), signal);
      signal?.throwIfAborted();
      const url = new URL(`https://api.trello.com/1${path}`);
      for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
      url.searchParams.set('key', appKey);
      url.searchParams.set('token', token);
      let response;
      let retryDelay = 500 * 2 ** attempt + random() * 250;
      const timeout = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        response = await fetchImpl(url.href, {
          method: 'GET', signal: requestSignal, credentials: 'omit',
          referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        });
        signal?.throwIfAborted();
        if (response.ok) {
          try {
            const body = await response.json();
            signal?.throwIfAborted();
            return body;
          } catch {
            signal?.throwIfAborted();
            if (timeout.aborted) throw new ApiError('network');
            throw new ApiError('shape');
          }
        }
        // Match only a fixed marker, never retain or surface the response body.
        if (response.status === 400 || response.status === 401) {
          const invalidKey = /invalid key/i.test(await response.text());
          if (invalidKey) throw new ApiError('setup', response.status);
        }
        if (response.status === 401) throw new ApiError('unauthorized', 401);
        if (response.status !== 429 && response.status < 500) {
          throw new ApiError('http', response.status);
        }
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
          // Do not retry earlier than a long server delay; return a visible error instead.
          if (delay > 60000) throw new ApiError('rate-limit', response.status);
          if (Number.isFinite(delay) && delay >= 0) retryDelay = Math.max(retryDelay, delay);
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ApiError && error.code !== 'network') throw error;
        if (attempt === 3) throw new ApiError('network');
      }
      if (attempt === 3) throw new ApiError('retry-exhausted', response?.status);
      await wait(retryDelay, signal);
    }
  }
  function boardPath(id, collection) {
    if (!/^[a-f\d]{24}$/i.test(id)) throw new ApiError('shape');
    return `/boards/${id}/${collection}`;
  }
  return {
    boards: signal => get('/members/me/boards', { filter: 'open', fields: 'name,url,closed' }, signal),
    projectedCards: (id, signal) => get(boardPath(id, 'cards'), {
      filter: 'open', fields: 'name,url', checklists: 'all', checklist_fields: 'name',
    }, signal),
    defaultCards: (id, signal) => get(boardPath(id, 'cards'), {
      filter: 'open', fields: 'name,url', checklists: 'all',
    }, signal),
    scanCards: (id, signal) => get(boardPath(id, 'cards'), {
      filter: 'open', fields: 'name,url,idList,idBoard,closed',
      checklists: 'all', checklist_fields: 'name',
    }, signal),
    card: (id, signal) => {
      if (!/^[a-f\d]{24}$/i.test(id)) throw new ApiError('shape');
      return get(`/cards/${id}`, { fields: 'idBoard,idList,closed' }, signal);
    },
    metadata: (id, signal) => get(boardPath(id, 'cards'), {
      filter: 'open', fields: 'name,url,idList,idBoard,closed',
    }, signal),
    lists: (id, signal) => get(boardPath(id, 'lists'), { filter: 'all', fields: 'closed' }, signal),
    checklists: (id, signal) => get(boardPath(id, 'checklists'), {}, signal),
  };
}
