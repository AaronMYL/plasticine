// 空间正文（shared/state-spaces.ts 的 SpaceDoc）摊成纯文字：全文索引、分身读材料、回顾里引用都用这一份。

/** 空间正文里能查的字：大标题、数字卡、小节、正文、图表和图片的说明、引用和出处。 */
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
