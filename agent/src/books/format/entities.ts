// Character references in book markup. The full HTML table has over 2,000 names; e-books in practice use the XML
// five, Latin-1 and typographic punctuation, so those are listed and anything else is left as written.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  hellip: '…',
  middot: '·',
  bull: '•',
  prime: '′',
  Prime: '″',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  lsaquo: '‹',
  rsaquo: '›',
  oline: '‾',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  micro: 'µ',
  para: '¶',
  sect: '§',
  copy: '©',
  reg: '®',
  laquo: '«',
  raquo: '»',
  iexcl: '¡',
  iquest: '¿',
  cent: '¢',
  pound: '£',
  yen: '¥',
  curren: '¤',
  brvbar: '¦',
  uml: '¨',
  ordf: 'ª',
  ordm: 'º',
  not: '¬',
  shy: '­',
  macr: '¯',
  acute: '´',
  cedil: '¸',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  szlig: 'ß',
  oelig: 'œ',
  OElig: 'Œ',
  scaron: 'š',
  Scaron: 'Š',
  yuml: 'ÿ',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
};

// Latin-1 letters follow one pattern (Agrave, eacute, ...), so they are generated rather than typed out.
const LATIN_LETTERS: Array<[string, string, string]> = [
  ['A', 'À', 'grave'], ['A', 'Á', 'acute'], ['A', 'Â', 'circ'], ['A', 'Ã', 'tilde'], ['A', 'Ä', 'uml'],
  ['A', 'Å', 'ring'], ['E', 'È', 'grave'], ['E', 'É', 'acute'], ['E', 'Ê', 'circ'], ['E', 'Ë', 'uml'],
  ['I', 'Ì', 'grave'], ['I', 'Í', 'acute'], ['I', 'Î', 'circ'], ['I', 'Ï', 'uml'], ['N', 'Ñ', 'tilde'],
  ['O', 'Ò', 'grave'], ['O', 'Ó', 'acute'], ['O', 'Ô', 'circ'], ['O', 'Õ', 'tilde'], ['O', 'Ö', 'uml'],
  ['U', 'Ù', 'grave'], ['U', 'Ú', 'acute'], ['U', 'Û', 'circ'], ['U', 'Ü', 'uml'], ['Y', 'Ý', 'acute'],
  ['C', 'Ç', 'cedil'],
];
for (const [letter, upper, suffix] of LATIN_LETTERS) {
  NAMED[`${letter}${suffix}`] = upper;
  NAMED[`${letter.toLowerCase()}${suffix}`] = upper.toLowerCase();
}
NAMED['AElig'] = 'Æ';
NAMED['aelig'] = 'æ';
NAMED['Oslash'] = 'Ø';
NAMED['oslash'] = 'ø';
NAMED['ETH'] = 'Ð';
NAMED['eth'] = 'ð';
NAMED['THORN'] = 'Þ';
NAMED['thorn'] = 'þ';

// Browsers read &#128;–&#159; as Windows-1252, and old e-books rely on it (&#150; for a dash).
const WINDOWS_1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const MAX_CODE_POINT = 0x10ffff;
const REPLACEMENT = '�';
const REFERENCE = /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

function fromCodePoint(value: number): string {
  if (value === 0 || value > MAX_CODE_POINT || (value >= 0xd800 && value <= 0xdfff)) {
    return REPLACEMENT;
  }
  return String.fromCodePoint(WINDOWS_1252[value] ?? value);
}

export function decodeEntities(text: string): string {
  if (!text.includes('&')) {
    return text;
  }
  return text.replace(REFERENCE, (whole, decimal: string | undefined, hex: string | undefined, name?: string) => {
    if (decimal !== undefined) {
      return fromCodePoint(Number.parseInt(decimal, 10));
    }
    if (hex !== undefined) {
      return fromCodePoint(Number.parseInt(hex, 16));
    }
    return (name !== undefined ? NAMED[name] : undefined) ?? whole;
  });
}
