import { ASSET_NAME_PATTERN } from './note-bodies.ts';

/** 只认本站资源路径；文件名是一个解码后的路径段，不能靠子串认领图片。 */
function assetName(source: string, origin?: string): string | null {
  let path = source.replaceAll('&amp;', '&');
  if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) {
    if (origin === undefined) {
      return null;
    }
    try {
      const url = new URL(path, origin);
      if (url.origin !== origin) {
        return null;
      }
      path = url.pathname;
    } catch {
      return null;
    }
  }
  const match = /^(?:\/v[12]\/notes\/assets\/|(?:\.\/)?assets\/)([^/?#]+)(?:[?#].*)?$/.exec(path);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    const name = decodeURIComponent(match[1]);
    return ASSET_NAME_PATTERN.test(name) ? name : null;
  } catch {
    return null;
  }
}

function label(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 支持笔记的 Markdown 图片、引用式图片和 img；代码与注释里的示例不算图片。 */
export function noteAssetRefs(markdown: string, origin?: string): Set<string> {
  const text = markdown
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/(`+)[\s\S]*?\1/g, '');
  const definitions = new Map<string, string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|([^\s]+))/gm)) {
    definitions.set(label(match[1] ?? ''), match[2] ?? match[3] ?? '');
  }
  const sources: string[] = [];
  const inline = /(?<!\\)!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
  for (const match of text.matchAll(inline)) {
    sources.push(match[1] ?? match[2] ?? '');
  }
  for (const match of text.matchAll(/(?<!\\)!\[([^\]]*)\](?:\[([^\]]*)\])?(?!\()/g)) {
    const source = definitions.get(label(match[2] || match[1] || ''));
    if (source !== undefined) {
      sources.push(source);
    }
  }
  for (const match of text.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    sources.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return new Set(sources.flatMap((source) => {
    const name = assetName(source, origin);
    return name === null ? [] : [name];
  }));
}
