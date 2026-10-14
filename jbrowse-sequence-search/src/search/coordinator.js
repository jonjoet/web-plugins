// Ensures only the latest search can publish results. Starting a search aborts
// the previous one; a superseded search still settles, but is marked stale so
// its results are discarded instead of overwriting the newer search.
export function createCoordinator() {
  let current = null;
  return {
    start(run) {
      current?.controller.abort();
      const ticket = { controller: new AbortController() };
      current = ticket;
      const promise = Promise.resolve()
        .then(() => run(ticket.controller.signal))
        .then(
          result => ({ result, stale: current !== ticket }),
          error => ({ error, stale: current !== ticket }),
        )
        .finally(() => {
          if (current === ticket) current = null;
        });
      return { ticket, promise };
    },
    cancel() {
      current?.controller.abort();
    },
    get running() {
      return current !== null;
    },
  };
}
