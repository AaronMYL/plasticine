// 几处共用的一句话截短（卡上的问题、标题、交付）：按字（不是 UTF-16 码元）截，截了的末尾带「…」，总长不超过 max。

export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
