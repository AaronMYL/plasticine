import type { MigrationCounts, MigrationResult } from '../../api/shared.ts';
import { timeInput } from '../../primitives/message/states.ts';

const KILO = 1024;

export function sizeText(bytes: number): string {
  if (bytes >= KILO ** 3) return `${(bytes / KILO ** 3).toFixed(1)} GB`;
  if (bytes >= KILO ** 2) return `${Math.round(bytes / KILO ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / KILO))} KB`;
}

export function stampText(iso: string, timeZone: string): string {
  return timeInput(iso, timeZone).slice(5, 16).replace('T', ' ');
}

export function dayText(iso: string, timeZone: string): string {
  return timeInput(iso, timeZone).slice(5, 10);
}

export function fromText(handle: string | null): string {
  return handle === null ? '另一台' : `@${handle}`;
}

export function countsText(counts: MigrationCounts): string {
  const parts: Array<[number, string]> = [[counts.lines, '段对话'], [counts.memory, '条记忆'], [counts.notes, '篇笔记'],
    [counts.files, '个文件'], [counts.books, '本书'], [counts.spaces, '个空间'], [counts.skills, '个技能']];
  const shown = parts.filter(([count]) => count > 0).slice(0, 4).map(([count, unit]) => `${count} ${unit}`);
  return shown.length === 0 ? '没有新的东西' : shown.join('、');
}

export function resultText(result: MigrationResult, timeZone: string): string {
  if (result.error !== null) {
    return result.error;
  }
  const from = fromText(result.handle);
  if (result.kind === 'undo') {
    return '已经退回到导入前。';
  }
  if (result.kind === 'replace') {
    return result.exportedAt === null ? `已换成${from}的数据。`
      : `已换成 ${from} ${stampText(result.exportedAt, timeZone)} 的数据。`;
  }
  const added = result.added === null ? '' : `加进来 ${countsText(result.added)}`;
  const kept = result.kept > 0 ? `；两边都有的 ${result.kept} 条留了这台的` : '';
  return `已合并 ${from} 的数据：${added}${kept}。`;
}
