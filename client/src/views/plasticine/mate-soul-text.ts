export const MATE_SOUL_HEADINGS = ['角色', '职责', '和谁协作', '队友独有'] as const;
export type MateSoulFields = Record<(typeof MATE_SOUL_HEADINGS)[number], string>;

/** Soul 仍是一份普通文本；四节编辑器读写同一字段，不另存一份副本。 */
export function readMateSoul(text: string, role: string): MateSoulFields {
  const fields: MateSoulFields = { 角色: role, 职责: '', 和谁协作: '', 队友独有: '' };
  let current: keyof MateSoulFields = '队友独有';
  const chunks = new Map<keyof MateSoulFields, string[]>();
  for (const line of text.split('\n')) {
    const heading = /^\s*#{1,3}\s*(角色|职责|和谁协作|协作|队友独有|只对它)\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      current = heading === '协作' ? '和谁协作' : heading === '只对它' ? '队友独有' : heading as keyof MateSoulFields;
      if (!chunks.has(current)) chunks.set(current, []);
    } else {
      const lines = chunks.get(current) ?? [];
      lines.push(line);
      chunks.set(current, lines);
    }
  }
  for (const [key, lines] of chunks) fields[key] = lines.join('\n').trim();
  return fields;
}
export function writeMateSoul(fields: MateSoulFields): string {
  return MATE_SOUL_HEADINGS.filter((heading) => fields[heading].trim() !== '')
    .map((heading) => `## ${heading}\n${fields[heading].trim()}`).join('\n\n');
}
