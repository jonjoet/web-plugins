const messages = {
  setup: 'Setup required: configure the public Power-Up API key and rebuild the site. See the README.',
  sdk: 'The Trello SDK could not load. Check your connection and reopen the Power-Up from a board.',
  storage: 'Trello authorization storage is unavailable. Reopen the Power-Up in your usual browser settings and try again. If it persists, integration verification is blocked.',
  denied: 'Authorization was denied. Choose Authorize when you are ready to grant read-only access.',
  cancelled: 'Authorization was cancelled. You can try again.',
  consent: 'Consent could not finish. Check that popups are allowed and the hosting origin is allowed on the API key, then try again.',
  unauthorized: 'Authorization has expired or been revoked. Authorize again to continue.',
  shape: 'Trello returned unexpected data. The check is incomplete; try again or inspect the count report.',
  network: 'Trello could not be reached after bounded retries. Check your connection and try again.',
  'rate-limit': 'Trello requested a long retry delay. Wait a minute before trying again.',
  'retry-exhausted': 'Trello is busy or rate-limited. Wait briefly, then try again.',
  http: 'Trello could not read this resource. Check board access and try again.',
  inconsistent: 'Trello data changed or a card or list could not be resolved. Refresh to try again.',
};

export function messageFor(error) {
  return messages[error?.code] || 'The connection could not finish. Reopen the Power-Up and try again.';
}

export function show(element, visible) { element.hidden = !visible; }

export function scanSummary(result) {
  const failed = result.failedBoards.length;
  const read = result.completedBoardIds.length + result.unverifiedBoardIds.length;
  const complete = result.complete && failed === 0
    && result.unverifiedBoardIds.length === 0 && result.issues.length === 0;
  const count = result.rows.length;
  const summary = complete && count === 0 ? 'Nothing overdue.'
    : count === 0 ? 'No overdue items found in the returned data.'
      : `${count} overdue ${count === 1 ? 'item' : 'items'} found.`;
  return { summary, complete,
    progress: `Read ${read} of ${result.totalBoards} ${result.totalBoards === 1 ? 'board' : 'boards'}.`,
    coverage: complete ? '' : (failed
      ? `${failed} of ${result.totalBoards} boards could not be checked. ` : '')
      + 'Some items may be missing; completeness has not been verified for the returned data.' };
}
