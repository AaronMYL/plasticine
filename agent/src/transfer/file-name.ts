const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const NAME_MAX_CHARS = 80;

export function safeFileName(title: string, fallback: string): string {
  const cleaned = title.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  const clipped = Array.from(cleaned).slice(0, NAME_MAX_CHARS).join('').trim();
  if (clipped === '') {
    return fallback;
  }
  return RESERVED.test(clipped) ? `_${clipped}` : clipped;
}

export function createNamer(): (directory: string, base: string, extension: string) => string {
  const used = new Set<string>();
  return (directory, base, extension) => {
    const prefix = directory === '' ? '' : `${directory}/`;
    for (let index = 1; ; index += 1) {
      const path = `${prefix}${index === 1 ? base : `${base} ${index}`}.${extension}`;
      const key = path.toLowerCase();
      if (!used.has(key)) {
        used.add(key);
        return path;
      }
    }
  };
}
