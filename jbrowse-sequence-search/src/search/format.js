import { BOTH, FORWARD } from './scan.js';

const number = new Intl.NumberFormat('en-US');

export function formatNumber(n) {
  return number.format(n);
}

export function formatBases(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Gb`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} Mb`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)} kb`;
  return `${formatNumber(n)} bp`;
}

export function strandLabel(strand) {
  if (strand === FORWARD) return '+';
  if (strand === BOTH) return 'both';
  return '−';
}

// Internal coordinates are 0-based, half-open. Users see 1-based, inclusive.
export function formatLocation(refName, start, end) {
  return `${refName}:${formatNumber(start + 1)}-${formatNumber(end)}`;
}

// Region to show for a hit: the match plus flanking sequence on each side,
// clipped to the contig.
export function navigationWindow(hit, regionStart, regionEnd) {
  const flank = Math.max(50, hit.end - hit.start);
  return {
    start: Math.max(regionStart, hit.start - flank),
    end: Math.min(regionEnd, hit.end + flank),
  };
}
