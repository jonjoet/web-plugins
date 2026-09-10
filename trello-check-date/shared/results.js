import { cardUrl, compareDue, daysOverdue, filterItems } from './overdue.js';
import { messageFor, scanSummary } from './ui.js';

const columns = [
  { key: 'itemName', label: 'Item' }, { key: 'cardName', label: 'Card' },
  { key: 'boardName', label: 'Board' }, { key: 'due', label: 'Due', numeric: true },
  { key: 'elapsedMs', label: 'Days overdue', numeric: true },
];
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function createResultsView(root, { openHere }) {
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const titles = { all: 'All active checklist items', dated: 'Active checklist items with a due date',
    overdue: 'Overdue checklist items' };
  const title = element('h2');
  const modeLabel = element('label', 'Show');
  modeLabel.htmlFor = 'item-mode';
  const mode = element('select');
  mode.id = 'item-mode';
  for (const [value, label] of [['all', 'All active items'], ['dated', 'With a due date'],
    ['overdue', 'Overdue only']]) {
    const option = element('option', label);
    option.value = value;
    mode.append(option);
  }
  mode.value = 'overdue';
  mode.addEventListener('change', drawResult);
  const scope = element('p');
  scope.id = 'scan-scope';
  const summary = element('p');
  summary.id = 'scan-summary';
  summary.setAttribute('role', 'status');
  const coverage = element('p', '', 'notice');
  coverage.id = 'scan-coverage';
  const time = element('p', '', 'footnote');
  time.id = 'scan-time';
  const failures = element('ul');
  failures.id = 'scan-errors';
  const scroll = element('div', undefined, 'table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Scrollable checklist items');
  const table = element('table');
  const caption = element('caption');
  const head = element('thead');
  const headerRow = element('tr');
  const body = element('tbody');
  const headers = [];
  let rows = [];
  let observation;
  let sortKey = 'due';
  let direction = 1;
  for (const column of columns) {
    const th = element('th');
    th.scope = 'col';
    const button = element('button', column.label);
    button.type = 'button';
    button.setAttribute('aria-label', column.label);
    button.addEventListener('click', () => {
      direction = sortKey === column.key ? -direction : column.key === 'elapsedMs' ? -1 : 1;
      sortKey = column.key;
      drawRows();
    });
    th.append(button);
    headerRow.append(th);
    headers.push(th);
  }
  head.append(headerRow);
  table.append(caption, head, body);
  scroll.append(table);
  root.replaceChildren(title, modeLabel, mode,
    element('p', 'Filters use the last scan without reading Trello again. Completed items and archived boards, lists, and cards are excluded in every mode.', 'footnote'),
    scope, summary, coverage, failures, time, scroll,
    element('p', 'Dates use your local timezone. Days overdue counts completed 24-hour periods; <1 means less than a day. A dash means no due date or not overdue at scan start.', 'footnote'));

  function drawRows() {
    const column = columns.find(c => c.key === sortKey);
    const ordered = [...rows].sort((a, b) => {
      const value = row => sortKey === 'elapsedMs' && !(row.elapsedMs > 0) ? null : row[sortKey];
      // Empty numeric cells stay last in either direction, never epoch zero.
      if (column.numeric && (value(a) === null || value(b) === null)) {
        return (value(a) === null) - (value(b) === null) || compareDue(a, b);
      }
      const difference = column.numeric ? value(a) - value(b)
        : a[sortKey].localeCompare(b[sortKey]);
      return direction * difference || compareDue(a, b);
    });
    headers.forEach((th, i) => th.setAttribute('aria-sort', columns[i].key !== sortKey
      ? 'none' : direction === 1 ? 'ascending' : 'descending'));
    body.replaceChildren();
    for (const row of ordered) {
      const tr = element('tr');
      const item = element('td', row.itemName);
      item.append(element('small', row.checklistName, 'checklist-name'));
      const card = element('td', row.cardName);
      const url = cardUrl(row.cardUrl);
      const actions = element('div', undefined, 'card-actions');
      const here = element('button', 'Open here', 'secondary');
      here.type = 'button';
      here.setAttribute('aria-label', `Open here: ${row.cardName}`);
      const newTab = element('a', 'Open in new tab', 'button-link secondary');
      newTab.href = url;
      newTab.target = '_blank';
      newTab.rel = 'noopener noreferrer';
      newTab.setAttribute('aria-label', `Open in new tab: ${row.cardName}`);
      const error = element('small', '', 'card-navigation-error');
      error.setAttribute('role', 'status');
      here.addEventListener('click', async () => {
        here.disabled = true;
        error.textContent = '';
        try { await openHere(url); }
        catch { error.textContent = 'Could not open this card here. Try again or use Open in new tab.'; }
        finally { here.disabled = false; }
      });
      actions.append(here, newTab);
      card.append(actions, error);
      const due = element('td', row.due === null ? '—' : undefined);
      if (row.due !== null) {
        const instant = element('time', dateFormat.format(row.due));
        instant.dateTime = new Date(row.due).toISOString();
        due.append(instant);
      }
      tr.append(item, card, element('td', row.boardName), due,
        element('td', row.elapsedMs > 0 ? daysOverdue(row.elapsedMs) : '—'));
      body.append(tr);
    }
    scroll.hidden = rows.length === 0;
  }

  function clear() { observation = undefined; rows = []; body.replaceChildren(); root.hidden = true; }
  function drawResult() {
    if (!observation) return;
    rows = filterItems(observation.rows, mode.value);
    sortKey = 'due'; direction = 1;
    title.textContent = titles[mode.value];
    caption.textContent = titles[mode.value];
    const text = scanSummary({ ...observation, rows }, mode.value);
    summary.textContent = text.summary;
    coverage.textContent = text.coverage;
    coverage.hidden = text.complete;
    time.textContent = `${text.progress} Last scan finished ${dateFormat.format(observation.finishedAt)}. Overdue status as of ${dateFormat.format(observation.startedAt)}.`;
    drawRows();
  }
  function render(result, { label, boardNames }) {
    observation = result;
    scope.textContent = label;
    failures.replaceChildren(...result.failedBoards.map(failure => element('li',
      `${boardNames.get(failure.boardId) || 'Unavailable board'}: ${messageFor(failure)}`)));
    failures.hidden = result.failedBoards.length === 0;
    drawResult();
    root.hidden = false;
  }
  return { clear, render };
}
