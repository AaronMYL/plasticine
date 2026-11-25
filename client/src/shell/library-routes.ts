import type { Route } from './routes.ts';

const SUB_SEGMENT = 'sub';
const TRASH_SEGMENT = 'trash';

export const LIBRARY_HOME: Route = { view: 'library', noteId: null };

export function subscriptionRoute(subscriptionId: string): Route {
  return { view: 'library', noteId: null, subscriptionId };
}

export const LIBRARY_TRASH: Route = { view: 'library', noteId: null, libraryTrash: true };

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

export function parseLibraryHash(segment: string | undefined, id: string | undefined): Route {
  if (segment === TRASH_SEGMENT) {
    return LIBRARY_TRASH;
  }
  if (segment === SUB_SEGMENT && id !== undefined) {
    const subscriptionId = decoded(id);
    return subscriptionId === null ? LIBRARY_HOME : subscriptionRoute(subscriptionId);
  }
  return LIBRARY_HOME;
}

export function libraryHash(route: Route): string {
  if (route.libraryTrash === true) {
    return `#/library/${TRASH_SEGMENT}`;
  }
  if (route.subscriptionId != null) {
    return `#/library/${SUB_SEGMENT}/${encodeURIComponent(route.subscriptionId)}`;
  }
  return '#/library';
}
