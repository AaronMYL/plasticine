export function spaceDocText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (!['type', 'kind', 'id', 'url'].includes(key)) {
        parts.push(value);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
    } else if (typeof value === 'object' && value !== null) {
      for (const [name, item] of Object.entries(value)) {
        walk(item, name);
      }
    }
  };
  walk(doc, '');
  return parts.join('\n');
}
