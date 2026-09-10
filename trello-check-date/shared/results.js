import { cardUrl, compareOverdue, daysOverdue } from './overdue.js';
import { messageFor, scanSummary } from './ui.js';

const columns = [
  { key: 'itemName', label: 'Item' }, { key: 'cardName', label: 'Card' },
  { key: 'boardName', label: 'Board' }, { key: 'due', label: 'Due', numeric: true },
  { key: 'elapsedMs', label: 'Days overdue', numeric: true },
];
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function createResultsView(root) {
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const title = element('h2', 'Overdue checklist items');
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
  scroll.setAttribute('aria-label', 'Scrollable overdue items');
  const table = element('table');
  const caption = element('caption', 'Incomplete, overdue checklist items');
  const head = element('thead');
  const headerRow = element('tr');
  const body = element('tbody');
  const headers = [];
  let rows = [];
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
  root.replaceChildren(title, scope, summary, coverage, failures, time, scroll,
    element('p', 'Dates use your local timezone. Days overdue counts completed 24-hour periods; <1 means less than a day.', 'footnote'));

  function drawRows() {
    const column = columns.find(c => c.key === sortKey);
    const ordered = [...rows].sort((a, b) => {
      const difference = column.numeric ? a[sortKey] - b[sortKey]
        : a[sortKey].localeCompare(b[sortKey]);
      return direction * difference || compareOverdue(a, b);
    });
    headers.forEach((th, i) => th.setAttribute('aria-sort', columns[i].key !== sortKey
      ? 'none' : direction === 1 ? 'ascending' : 'descending'));
    body.replaceChildren();
    for (const row of ordered) {
      const tr = element('tr');
      const item = element('td', row.itemName);
      item.append(element('small', row.checklistName, 'checklist-name'));
      const card = element('td');
      const link = element('a', row.cardName);
      link.href = cardUrl(row.cardUrl);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(link);
      const due = element('td');
      const instant = element('time', dateFormat.format(row.due));
      instant.dateTime = new Date(row.due).toISOString();
      due.append(instant);
      tr.append(item, card, element('td', row.boardName), due, element('td', daysOverdue(row.elapsedMs)));
      body.append(tr);
    }
    scroll.hidden = rows.length === 0;
  }

  function clear() { rows = []; body.replaceChildren(); root.hidden = true; }
  function render(result, { label, boardNames }) {
    rows = result.rows;
    sortKey = 'due'; direction = 1;
    const text = scanSummary(result);
    scope.textContent = label;
    summary.textContent = text.summary;
    coverage.textContent = text.coverage;
    coverage.hidden = text.complete;
    time.textContent = `${text.progress} Last scan finished ${dateFormat.format(result.finishedAt)}.`;
    failures.replaceChildren(...result.failedBoards.map(failure => element('li',
      `${boardNames.get(failure.boardId) || 'Unavailable board'}: ${messageFor(failure)}`)));
    failures.hidden = result.failedBoards.length === 0;
    drawRows();
    root.hidden = false;
  }
  return { clear, render };
}
