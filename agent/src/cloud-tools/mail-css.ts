export type ImageResolver = (url: string) => string | null;

const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))/g;
const MAX_CODE_POINT = 0x10ffff;
const URL_FUNCTION = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
const DANGEROUS_VALUE = /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i;
const IMPORT_RULE = /@import\b[^;]*;?/gi;
const CHARSET_RULE = /@charset\b[^;]*;?/gi;

function unescapeCss(css: string): string {
  return css.replace(CSS_ESCAPE, (whole, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) {
      return char ?? '';
    }
    const code = Number.parseInt(hex, 16);
    if (code === 0 || code > MAX_CODE_POINT || (code >= 0xd800 && code <= 0xdfff)) {
      return '�';
    }
    return String.fromCodePoint(code);
  });
}

function rewriteUrls(css: string, image: ImageResolver): string {
  return css.replace(URL_FUNCTION, (_whole, double: string | undefined, single: string | undefined,
    bare: string | undefined) => {
    const resolved = image((double ?? single ?? bare ?? '').trim());
    return resolved === null ? 'none' : `url("${resolved.replace(/["\\\n\r]/g, '')}")`;
  });
}

export function sanitizeStyleAttribute(value: string, image: ImageResolver): string {
  const declarations = unescapeCss(value).split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '' && !DANGEROUS_VALUE.test(declaration));
  return rewriteUrls(declarations.join(';'), image);
}

export function sanitizeStyleSheet(css: string, image: ImageResolver): string {
  const plain = unescapeCss(css).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(IMPORT_RULE, '')
    .replace(CHARSET_RULE, '');
  const safe = plain.replace(/[^;{}]+/g, (declaration) => DANGEROUS_VALUE.test(declaration) ? '' : declaration);
  return rewriteUrls(safe, image).replace(/<\//g, '<\\/');
}
