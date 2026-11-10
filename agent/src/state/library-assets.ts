import { tokenizeHtml } from '../../shared/space-html.ts';
import { SpaceDocSchema } from '../../shared/state.ts';
import { checked } from './codec.ts';
import { noteAssetName, noteAssetRefs } from './note-asset-refs.ts';

/** 和渲染器一样只把完整的站内资源网址当作引用，不匹配外站地址中的路径子串。 */
export function spaceAssetRefs(doc: string, html: string): Set<string> {
  const result = new Set<string>();
  const add = (source: string): void => {
    const name = noteAssetName(source);
    if (name !== null) result.add(name);
  };
  const style = (css: string): void => {
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)) {
      add(match[1] ?? match[2] ?? match[3] ?? '');
    }
  };
  const page = checked(SpaceDocSchema, JSON.parse(doc), 'corrupt_record', '空间资源引用');
  for (const block of page.blocks) {
    if (block.type === 'image') add(block.url);
    if (block.type === 'text') for (const name of noteAssetRefs(block.markdown)) result.add(name);
  }
  for (const token of tokenizeHtml(html)) {
    if (token.type !== 'start') continue;
    if (token.name === 'style' && token.raw !== null) style(token.raw);
    for (const attribute of token.attrs) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value ?? '';
      if (['src', 'poster', 'background', 'href', 'xlink:href'].includes(name)) add(value);
      if (name === 'style') style(value);
      if (name === 'srcset') for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/)[0] ?? '');
    }
  }
  return result;
}
