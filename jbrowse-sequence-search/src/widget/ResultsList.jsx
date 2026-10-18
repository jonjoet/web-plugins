import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react';
import { formatNumber, shortSequence, strandLabel } from '../search/format.js';

// Long exact queries are shown shortened; coordinates stay exact.
const LIST_SEQUENCE_MAX = 100;

// Two lines per row: coordinates, then the matched sequence, so all columns
// stay readable in a narrow side panel.
const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 12;
const OVERSCAN = 6;
const COLUMNS = '3em minmax(3em, 1fr) 6.8em 6.8em 4.4em';

const cell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 4px' };
const numeric = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function Row({ hit, selected, onSelect, style }) {
  return (
    <div role="row" aria-selected={selected} style={style}>
      <button
        type="button"
        data-testid="genome-search-row"
        data-index={hit.index}
        onClick={() => onSelect(hit.index)}
        title={`Go to match ${hit.index + 1}`}
        style={{
          display: 'grid', gridTemplateColumns: COLUMNS, alignContent: 'center', width: '100%', height: ROW_HEIGHT,
          border: 0, borderBottom: '1px solid rgba(128,128,128,0.2)', cursor: 'pointer', font: 'inherit', textAlign: 'left',
          background: selected ? 'rgba(25,118,210,0.16)' : 'transparent', color: 'inherit', padding: 0,
        }}
      >
        <span role="cell" style={numeric}>{formatNumber(hit.index + 1)}</span>
        <span role="cell" style={cell}>{hit.refName}</span>
        <span role="cell" style={numeric}>{formatNumber(hit.start + 1)}</span>
        <span role="cell" style={numeric}>{formatNumber(hit.end)}</span>
        <span role="cell" style={{ ...cell, textAlign: 'center' }}>{strandLabel(hit.strand)}</span>
        <span role="cell" style={{ ...cell, gridColumn: '2 / -1', fontFamily: 'monospace', opacity: 0.8 }} title={shortSequence(hit.matched, LIST_SEQUENCE_MAX)}>{shortSequence(hit.matched, LIST_SEQUENCE_MAX)}</span>
      </button>
    </div>
  );
}

// Renders only the rows in (or near) the scrolled window, so tens of
// thousands of results stay responsive.
const ResultsList = observer(function ResultsList({ hits, selectedIndex, onSelect }) {
  const scroller = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const height = Math.min(hits.length, VISIBLE_ROWS) * ROW_HEIGHT;

  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [selectedIndex]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(hits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <Row
        key={i}
        hit={hits[i]}
        selected={i === selectedIndex}
        onSelect={onSelect}
        style={{ position: 'absolute', top: i * ROW_HEIGHT, left: 0, right: 0 }}
      />,
    );
  }
  return (
    <div role="table" aria-label="Search results" aria-rowcount={hits.length} style={{ fontSize: '0.8rem' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: COLUMNS, fontWeight: 600, borderBottom: '2px solid rgba(128,128,128,0.4)', paddingBottom: 2 }}>
        <span role="columnheader" style={numeric}>#</span>
        <span role="columnheader" style={cell}>Sequence</span>
        <span role="columnheader" style={numeric}>Start</span>
        <span role="columnheader" style={numeric}>End</span>
        <span role="columnheader" style={{ ...cell, textAlign: 'center' }}>Strand</span>
        <span role="columnheader" style={{ ...cell, gridColumn: '2 / -1', fontWeight: 400 }}>Matched sequence (5′→3′ on the match strand)</span>
      </div>
      <div
        ref={scroller}
        data-testid="genome-search-results"
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        style={{ height, overflowY: 'auto', position: 'relative' }}
      >
        <div style={{ height: hits.length * ROW_HEIGHT, position: 'relative' }}>{rows}</div>
      </div>
    </div>
  );
});

export default ResultsList;
