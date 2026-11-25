export const EXTERNAL_LINK = /(?:(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:)?\/\/[^\s<>"'`\\，。；（）【】]+/gi;
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };
const OPENING_BRACKETS = new Set(Object.values(CLOSING_BRACKETS));

export function splitLink(raw: string): { link: string; suffix: string } {
  const balance = new Map<string, number>();
  for (const char of raw) {
    const opening = CLOSING_BRACKETS[char];
    if (opening !== undefined) {
      balance.set(opening, (balance.get(opening) ?? 0) - 1);
    } else if (OPENING_BRACKETS.has(char)) {
      balance.set(char, (balance.get(char) ?? 0) + 1);
    }
  }
  let end = raw.length;
  while (end > 0) {
    const opening = CLOSING_BRACKETS[raw[end - 1] ?? ''];
    if (opening === undefined || (balance.get(opening) ?? 0) >= 0) {
      break;
    }
    balance.set(opening, (balance.get(opening) ?? 0) + 1);
    end -= 1;
  }
  return { link: raw.slice(0, end), suffix: raw.slice(end) };
}

