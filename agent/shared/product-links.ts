/** 产品地图和客户端共用这些深链，名字来自产品栏目。 */
export const PRODUCT_ROUTES = [
  { kind: 'note', view: 'notes', prefix: '#/notes/', field: 'noteId' },
  { kind: 'space', view: 'books', prefix: '#/books/space/', field: 'spaceId' },
  { kind: 'book', view: 'books', prefix: '#/books/', field: 'bookId' },
  { kind: 'project', view: 'projects', prefix: '#/projects/', field: 'projectId' },
  { kind: 'contact', view: 'messages', prefix: '#/messages/', field: 'contactId' },
  { kind: 'web', view: 'web', prefix: '#/web/', field: 'webTabId' },
] as const;
export type ProductLinkKind = (typeof PRODUCT_ROUTES)[number]['kind'];
export function productLink(kind: ProductLinkKind, id: string): string {
  const route = PRODUCT_ROUTES.find((entry) => entry.kind === kind)!;
  return `${route.prefix}${encodeURIComponent(id)}`;
}
