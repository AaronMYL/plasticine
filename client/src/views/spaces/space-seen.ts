// 哪几期空间在这台设备上打开过（信息流第二栏「订阅」那一行的新一期点）：只记空间 id，存在 localStorage，最多记 200 个。

const KEY = 'plasticine:spaces-seen';
const MAX = 200;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch (cause) {
    console.warn('看过的空间读不出来，当都没看过', cause);
    return [];
  }
}

export function seenSpace(id: string): boolean {
  return read().includes(id);
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
