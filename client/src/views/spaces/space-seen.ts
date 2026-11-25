const KEY = 'plasticine:spaces-seen';
const MAX = 200;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch (cause) {
    console.warn('看过的空间没读到，当都没看过', cause);
    return [];
  }
}

export function markSpaceSeen(id: string): void {
  const list = read();
  if (list.includes(id)) {
    return;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify([id, ...list].slice(0, MAX)));
  } catch (cause) {
    console.warn('看过的空间没能记下，下次还会带新一期的点', cause);
  }
}
