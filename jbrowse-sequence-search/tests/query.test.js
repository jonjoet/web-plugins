import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AMBIGUOUS_LENGTH, MAX_EXACT_LENGTH, parseQuery } from '../src/search/query.js';

test('normalizes case and pasted formatting', () => {
  const q = parseQuery('  gaattc\n  ggatcc  \r\n');
  assert.equal(q.sequence, 'GAATTCGGATCC');
  assert.deepEqual(q.notes, ['Ignored spaces and line breaks.']);
});

test('accepts one FASTA header and GenBank-style numbering', () => {
  const q = parseQuery('>my oligo\n1 acgtacgtac gtacgt\n17 ACGT\n');
  assert.equal(q.sequence, 'ACGTACGTACGTACGTACGT');
  assert.deepEqual(q.notes, ['Ignored the FASTA header line.', 'Ignored spaces, line breaks and numbers.']);
});

test('rejects multiple FASTA records and misplaced headers', () => {
  assert.match(parseQuery('>a\nACGT\n>b\nACGT').error, /more than one FASTA record/);
  assert.match(parseQuery('ACGT\n>b').error, /must be the first line/);
});

test('rejects empty input', () => {
  assert.match(parseQuery('').error, /Enter a DNA sequence/);
  assert.match(parseQuery(' \n ').error, /Enter a DNA sequence/);
  assert.match(parseQuery('>header only').error, /Enter a DNA sequence/);
  assert.match(parseQuery(undefined).error, /Enter a DNA sequence/);
});

test('ambiguity codes require the option and are never silently treated as bases', () => {
  const r = parseQuery('GANTC');
  assert.equal(r.ok, false);
  assert.match(r.error, /ambiguity code “N”.*Allow ambiguity codes/);
  const ok = parseQuery('ganTC', { allowAmbiguity: true });
  assert.equal(ok.sequence, 'GANTC');
  assert.equal(ok.ambiguous, true);
  // With the option on, a plain query is still an exact search.
  assert.equal(parseQuery('GAATTC', { allowAmbiguity: true }).ambiguous, false);
});

test('regex syntax and other characters are rejected with explanations', () => {
  assert.match(parseQuery('GA.TC').error, /regular-expression/);
  assert.match(parseQuery('GA[AT]TC').error, /regular-expression/);
  assert.match(parseQuery('GA*').error, /regular-expression/);
  assert.match(parseQuery('ACGU').error, /uracil/);
  assert.match(parseQuery('AC-GT').error, /Gap characters/);
  assert.match(parseQuery('ACGTX').error, /not DNA letters: “X”/);
  assert.match(parseQuery('MKVL*', {}).error, /regular-expression/);
});

test('enforces length limits', () => {
  assert.equal(parseQuery('A'.repeat(MAX_EXACT_LENGTH)).ok, true);
  assert.match(parseQuery('A'.repeat(MAX_EXACT_LENGTH + 1)).error, /at most 1000 bases/);
  assert.equal(parseQuery('N'.repeat(MAX_AMBIGUOUS_LENGTH), { allowAmbiguity: true }).ok, true);
  assert.match(parseQuery('N'.repeat(MAX_AMBIGUOUS_LENGTH + 1), { allowAmbiguity: true }).error, /ambiguity codes can be at most 100/);
});

test('reports reverse complement and palindromes', () => {
  assert.equal(parseQuery('GAATTC').palindromic, true);
  const q = parseQuery('AAGCTTC');
  assert.equal(q.reverseComplement, 'GAAGCTT');
  assert.equal(q.palindromic, false);
  assert.equal(parseQuery('RY', { allowAmbiguity: true }).palindromic, true);
});
