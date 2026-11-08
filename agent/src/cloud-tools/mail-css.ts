// 邮件里的 CSS（style 属性和 <style> 块）的清洗：排版样式原样留着，能把东西带进来或跑代码的去掉——@import、IE 的
// expression() / behavior、Firefox 的 -moz-binding、javascript: 地址；url(…) 里的图交给换图回调（入库时只留 cid: 和
// http(s)，显示时换成 data: 或服务端代理）。CSS 转义（\75 rl、\:）先展开再查，免得绕过去。iframe 里的 CSP 只放行
// data: 和本站代理，这里漏掉的也载不进来。

/** 一个图片地址 → 放进去的地址；null = 去掉。 */
export type ImageResolver = (url: string) => string | null;

const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f0-9a-fA-F]))/g;
const MAX_CODE_POINT = 0x10ffff;
const URL_FUNCTION = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
// 会请求外部或执行的写法：整条去掉（换成 none 或空）。
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

/** 一条 style 属性：按分号切开，危险的那条整条去掉，url() 过换图回调。 */
export function sanitizeStyleAttribute(value: string, image: ImageResolver): string {
  const declarations = unescapeCss(value).split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '' && !DANGEROUS_VALUE.test(declaration));
  return rewriteUrls(declarations.join(';'), image);
}

/** 一个 <style> 块：去掉 @import / @charset 和危险的声明，url() 过换图回调；结果里不会出现 </style。 */
export function sanitizeStyleSheet(css: string, image: ImageResolver): string {
  const plain = unescapeCss(css).replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(IMPORT_RULE, '')
    .replace(CHARSET_RULE, '');
  // 只在一条声明（两个 ; { } 之间）里去掉危险的部分，选择器和别的规则不动。
  const safe = plain.replace(/[^;{}]+/g, (declaration) => DANGEROUS_VALUE.test(declaration) ? '' : declaration);
  return rewriteUrls(safe, image).replace(/<\//g, '<\\/');
}
