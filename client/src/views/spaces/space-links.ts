// 空间里的出处点回去（第 7 条：每条重要结论能点回原对话、项目记录或原始资料）：站内链接换成地址，正文里的 [^n]
// 换成上标数字。

import type { SpaceLink, SpaceSource } from '../../api/shared.ts';
import { mainLineRoute, routeHash, type Route } from '../../shell/routes.ts';

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** 2 → ²，12 → ¹²。 */
export function superscript(value: number): string {
  return String(value).split('').map((digit) => SUPERSCRIPTS[Number(digit)] ?? digit).join('');
}

/** 正文里的 [^n] 换成上标（设计稿 Library-Space「重放越多¹」）。 */
export function withFootnotes(markdown: string): string {
  return markdown.replace(/\[\^(\d+)\]/g, (_match, number: string) => superscript(Number(number)));
}

export function linkRoute(link: SpaceLink): Route {
  const id = link.id;
  switch (link.kind) {
    case 'message': return mainLineRoute(id);
    case 'line': return { view: 'work', noteId: null, lineId: id };
    case 'project': return { view: 'projects', noteId: null, projectId: id };
    case 'memory_doc': return { view: 'memory', noteId: null, topicId: id };
    case 'note': return { view: 'notes', noteId: id };
    case 'space': return { view: 'books', noteId: null, bookId: null, spaceId: id };
    case 'feed_item': return { view: 'feed', noteId: null, feedItemId: id };
  }
}

/** 出处去哪：站内的给地址，网址原样；都没有是 null（只是一句说法）。 */
export function sourceHref(source: SpaceSource): string | null {
  if (source.link !== undefined) {
    return routeHash(linkRoute(source.link));
  }
  return source.url ?? null;
}

export function spaceRoute(id: string): Route {
  return { view: 'books', noteId: null, bookId: null, spaceId: id };
}
