// IUPAC nucleotide codes. A query code matches a genome base when the base is
// one of the code's concrete bases. Genome bases other than A, C, G and T
// (for example N gaps or ambiguity codes in the reference) never match.
export const BASES = Object.freeze({
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
});

const COMPLEMENT = Object.freeze({
  A: 'T', C: 'G', G: 'C', T: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', D: 'H', H: 'D', V: 'B', N: 'N',
});

export const AMBIGUITY_CODES = 'RYSWKMBDHVN';

export function isConcrete(sequence) {
  return /^[ACGT]*$/.test(sequence);
}

// Reverse complement of an uppercase DNA or IUPAC sequence.
export function reverseComplement(sequence) {
  let out = '';
  for (let i = sequence.length - 1; i >= 0; i--) {
    const c = COMPLEMENT[sequence[i]];
    if (!c) throw new Error(`Cannot complement "${sequence[i]}"`);
    out += c;
  }
  return out;
}

// Regular-expression source for a validated IUPAC sequence. The input is never
// user regex syntax: every character is mapped to a fixed character class.
export function patternSource(sequence) {
  let source = '';
  for (const code of sequence) {
    const bases = BASES[code];
    if (!bases) throw new Error(`Not a nucleotide code: "${code}"`);
    source += bases.length === 1 ? bases : `[${bases}]`;
  }
  return source;
}

// True when a concrete base sequence matches the IUPAC pattern at every position.
export function matchesPattern(bases, pattern) {
  if (bases.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (!BASES[pattern[i]].includes(bases[i])) return false;
  }
  return true;
}
