// 邮件 HTML 里会碰到的命名实体（HTML 标准的子集）。全表两千多条，邮件里出现的几乎都在下面：空白与零宽、引号与标点、
// 货币、常用符号、拉丁字母变音。不在表里的命名实体原样留着（看得见总比猜错好）；数字实体另由 decodeEntities 全部还原。

export const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  // 语法字符
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // 空白、零宽、方向
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', hairsp: ' ', numsp: ' ',
  puncsp: ' ', MediumSpace: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏',
  shy: '­', NoBreak: '⁠', ZeroWidthSpace: '​',
  // 引号、破折号、标点
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', ndash: '–', mdash: '—',
  hellip: '…', bull: '•', middot: '·', prime: '′', Prime: '″', dagger: '†',
  Dagger: '‡', permil: '‰', iexcl: '¡', iquest: '¿', sect: '§', para: '¶',
  brvbar: '¦', uml: '¨', macr: '¯', acute: '´', cedil: '¸', ordf: 'ª',
  ordm: 'º', oline: '‾', frasl: '⁄', colon: ':', comma: ',', period: '.', excl: '!',
  quest: '?', num: '#', percnt: '%', lpar: '(', rpar: ')', ast: '*', plus: '+', sol: '/', bsol: '\\',
  semi: ';', equals: '=', commat: '@', lsqb: '[', rsqb: ']', lowbar: '_', grave: '`', lcub: '{', rcub: '}',
  verbar: '|', vert: '|', dollar: '$', Hat: '^', tilde: '˜', circ: 'ˆ', NewLine: '\n', Tab: '\t',
  // 货币
  cent: '¢', pound: '£', curren: '¤', yen: '¥', euro: '€',
  // 常用符号
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×',
  divide: '÷', micro: 'µ', not: '¬', sup1: '¹', sup2: '²', sup3: '³',
  frac14: '¼', frac12: '½', frac34: '¾', larr: '←', uarr: '↑', rarr: '→',
  darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔', minus: '−',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', sum: '∑', radic: '√',
  loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦', check: '✓',
  cross: '✗', star: '☆', starf: '★', phone: '☎', female: '♀', male: '♂',
  // 拉丁字母变音
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ',
  szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä',
  aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê',
  euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  thorn: 'þ', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š',
  Yuml: 'Ÿ', fnof: 'ƒ',
  // 希腊字母（数学、单位里常见的几个）
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', pi: 'π',
  mu: 'μ', sigma: 'σ', Omega: 'Ω', omega: 'ω', lambda: 'λ', theta: 'θ',
};
