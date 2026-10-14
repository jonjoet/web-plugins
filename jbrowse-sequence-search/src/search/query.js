import { AMBIGUITY_CODES, isConcrete, reverseComplement } from './iupac.js';

export const MAX_EXACT_LENGTH = 1000;
export const MAX_AMBIGUOUS_LENGTH = 100;

const REGEX_SYNTAX = /[.*+?^$()[\]{}|\\]/;

function invalid(error) {
  return { ok: false, error };
}

function listCharacters(characters) {
  return [...new Set(characters)].map(c => `“${c}”`).join(', ');
}

// Cleans pasted text and validates it as a DNA query.
// Accepted formatting: one optional FASTA header line (">..." as the first
// non-blank line), and whitespace or digits anywhere (GenBank/EMBL style
// numbering). Everything else must be a nucleotide code.
export function parseQuery(text, { allowAmbiguity = false } = {}) {
  if (typeof text !== 'string') return invalid('Enter a DNA sequence.');
  const notes = [];
  const lines = text.split(/\r\n|\r|\n/);
  const headers = lines.filter(line => line.trim().startsWith('>'));
  if (headers.length > 1) {
    return invalid('This looks like more than one FASTA record. Paste a single sequence.');
  }
  let body = lines;
  if (headers.length === 1) {
    const first = lines.findIndex(line => line.trim() !== '');
    if (!lines[first].trim().startsWith('>')) {
      return invalid('A FASTA header (“>”) must be the first line.');
    }
    body = lines.slice(first + 1);
    notes.push('Ignored the FASTA header line.');
  }
  const joined = body.join('');
  const withoutSpace = joined.replace(/\s+/g, '');
  const cleaned = withoutSpace.replace(/[0-9]+/g, '');
  if (withoutSpace !== joined.trim() || cleaned !== withoutSpace) {
    notes.push(cleaned !== withoutSpace
      ? 'Ignored spaces, line breaks and numbers.'
      : 'Ignored spaces and line breaks.');
  }
  if (cleaned === '') return invalid('Enter a DNA sequence.');

  const sequence = cleaned.toUpperCase();
  const bad = [...sequence].filter(c => !'ACGT'.includes(c) && !AMBIGUITY_CODES.includes(c));
  if (bad.length) {
    if (bad.includes('U')) return invalid('Contains U (uracil). Enter the sequence as DNA, using T.');
    if (bad.some(c => c === '-')) return invalid('Gap characters (“-”) are not supported.');
    if (bad.some(c => REGEX_SYNTAX.test(c))) {
      return invalid(`Contains ${listCharacters(bad)}. Only DNA letters are accepted; pattern (regular-expression) syntax is not supported.`);
    }
    return invalid(`Contains characters that are not DNA letters: ${listCharacters(bad)}.`);
  }
  const ambiguous = !isConcrete(sequence);
  if (ambiguous && !allowAmbiguity) {
    const codes = [...sequence].filter(c => AMBIGUITY_CODES.includes(c));
    return invalid(`Contains the ambiguity code ${listCharacters(codes)}. Turn on “Allow ambiguity codes” to use it, or remove it.`);
  }
  const limit = ambiguous ? MAX_AMBIGUOUS_LENGTH : MAX_EXACT_LENGTH;
  if (sequence.length > limit) {
    return invalid(ambiguous
      ? `Sequences with ambiguity codes can be at most ${limit} bases (this one is ${sequence.length}).`
      : `Sequences can be at most ${limit} bases (this one is ${sequence.length}).`);
  }
  const reverse = reverseComplement(sequence);
  return {
    ok: true,
    sequence,
    reverseComplement: reverse,
    length: sequence.length,
    ambiguous,
    palindromic: reverse === sequence,
    notes,
  };
}
