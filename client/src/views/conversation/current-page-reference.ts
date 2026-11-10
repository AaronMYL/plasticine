import type { PlasticineApi } from '../../api/client.ts';
import type { Quote } from '../../api/types.ts';
import type { CurrentTab } from '../../shell/current-tab-context.ts';
import { productLink } from '../../../../agent/shared/product-links.ts';

/** 当前页是定位信息；全文仍由明确引用或工具读取取得。 */
export async function currentPageReference(tab: CurrentTab | null, api: PlasticineApi): Promise<Quote | null> {
  if (tab === null) return null;
  const route = tab.route;
  let source: { type: string; id: string; title: string; version: number | null; link: string };
  if (route?.spaceId != null) {
    const space = await api.spaces.get(route.spaceId);
    const version = route.spacePosition?.version ?? space.version;
    const historical = version === space.version ? null : (await api.spaces.versions(space.id, version)).selected;
    source = { type: 'space', id: space.id, title: historical?.title ?? space.title, version,
      link: productLink('space', space.id) };
  } else if (route?.view === 'notes' && route.noteId !== null) {
    const note = await api.notes.get(route.noteId);
    if (note.private) return null;
    source = { type: 'note', id: note.id, title: note.title, version: note.version, link: productLink('note', note.id) };
  } else if (route?.bookId != null) {
    const book = await api.books.get(route.bookId);
    source = { type: 'book', id: book.id, title: book.title, version: book.version, link: productLink('book', book.id) };
  } else if (tab.kind === 'web' && tab.url !== null) {
    source = { type: 'web', id: tab.id, title: tab.title, version: null, link: tab.url };
  } else return null;
  const ref = `${source.type}:${source.id}${source.version === null ? '' : `@${source.version}`}`;
  return { id: `current:${ref}`, kind: 'object', sourceId: ref, label: source.title,
    text: `〔当前页〕[${ref}]\n${source.title}\n${source.link}` };
}
