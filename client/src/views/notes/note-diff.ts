export interface NoteChange {
  start: number;
  end: number;
  before: string;
  after: string;
}

/** 按行找共同锚点，连续不同的行归为一处；不把整篇全文当作一个替换。 */
export function noteChanges(before: string, after: string): NoteChange[] {
  const old: string[] = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const next: string[] = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const changes: NoteChange[] = [];
  let i = 0;
  let j = 0;
  let offset = 0;
  while (i < old.length || j < next.length) {
    if (old[i] !== undefined && old[i] === next[j]) {
      offset += old[i]!.length;
      i += 1;
      j += 1;
      continue;
    }
    const start = offset;
    const removed: string[] = [];
    const added: string[] = [];
    while (i < old.length || j < next.length) {
      if (old[i] !== undefined && old[i] === next[j]) { break; }
      const oldMatch = next[j] === undefined ? -1 : old.indexOf(next[j]!, i + 1);
      const nextMatch = old[i] === undefined ? -1 : next.indexOf(old[i]!, j + 1);
      if (oldMatch !== -1 && (nextMatch === -1 || oldMatch - i <= nextMatch - j)) {
        while (i < oldMatch) { removed.push(old[i++]!); }
      } else if (nextMatch !== -1) {
        while (j < nextMatch) { added.push(next[j++]!); }
      } else {
        if (i < old.length) { removed.push(old[i++]!); }
        if (j < next.length) { added.push(next[j++]!); }
      }
    }
    const text = removed.join('');
    offset += text.length;
    changes.push({ start, end: offset, before: text, after: added.join('') });
  }
  return changes;
}

/** 对照期间的新输入按位置接续。重叠改动必须重新对照，不覆盖已经写下的字。 */
export function applyNoteChanges(base: string, current: string, selected: readonly NoteChange[]): string {
  const local = noteChanges(base, current);
  const mapped = selected.map((change) => {
    const overlaps = local.some((edit) => change.start < edit.end && edit.start < change.end
      || change.start === change.end && edit.start <= change.start && edit.end >= change.start
      || edit.start === edit.end && edit.start > change.start && edit.start < change.end);
    if (overlaps) { throw new Error('这处文字在对照期间又改过了。保留当前正文，重新生成这一处建议。'); }
    const shift = local.filter((edit) => edit.end <= change.start)
      .reduce((sum, edit) => sum + edit.after.length - edit.before.length, 0);
    return { ...change, start: change.start + shift, end: change.end + shift };
  });
  let result = current;
  for (const change of mapped.toSorted((a, b) => b.start - a.start)) {
    result = result.slice(0, change.start) + change.after + result.slice(change.end);
  }
  return result;
}
