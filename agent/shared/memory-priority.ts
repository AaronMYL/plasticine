// 记忆里两条说法冲突时以哪条为准（11-11 Aaron 定）：Aaron 明说的高于推断的，范围窄的高于范围宽的，新的高于旧的。
// 服务端排提示词、找冲突，界面标「现在以这条为准」都用这一份。

import type { MemoryLine } from './state-memory-docs.ts';

/** 界面上的来源：你说的 / 你确认过（推断）/ 队友设定（原队友 Soul 拆出来的）/ 系统默认。 */
export const MEMORY_SOURCES = ['said', 'confirmed', 'mate', 'system'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export const MEMORY_SOURCE_LABELS: Readonly<Record<MemorySource, string>> = {
  said: '你说的', confirmed: '你确认过', mate: '队友设定', system: '系统默认',
};

type Ranked = Pick<MemoryLine, 'basis' | 'anchors' | 'scopeKind' | 'createdAt'>;

export function memorySource(line: Pick<MemoryLine, 'basis' | 'anchors'>): MemorySource {
  if (line.anchors.some((anchor) => anchor.kind === 'mate')) return 'mate';
  if (line.basis === 'system') return 'system';
  return line.basis === 'confirmed_inference' ? 'confirmed' : 'said';
}

const SOURCE_RANK: Readonly<Record<MemorySource, number>> = { said: 3, confirmed: 2, mate: 1, system: 0 };

/** 负数：a 优先；正数：b 优先。 */
export function comparePriority(a: Ranked, b: Ranked): number {
  const source = SOURCE_RANK[memorySource(b)] - SOURCE_RANK[memorySource(a)];
  if (source !== 0) return source;
  const scope = Number(b.scopeKind !== 'all') - Number(a.scopeKind !== 'all');
  if (scope !== 0) return scope;
  return b.createdAt.localeCompare(a.createdAt);
}

const REASON_LABELS: Readonly<Record<MemorySource, string>> = {
  said: '你说的', confirmed: '你确认过的推断', mate: '队友设定', system: '系统默认',
};

/** 为什么以 winner 为准（一句）。 */
export function priorityReason(winner: Ranked, other: Ranked): string {
  const a = memorySource(winner);
  const b = memorySource(other);
  if (SOURCE_RANK[a] !== SOURCE_RANK[b]) {
    return `${REASON_LABELS[a]}优先于${REASON_LABELS[b]}`;
  }
  if ((winner.scopeKind !== 'all') !== (other.scopeKind !== 'all')) return '范围窄的优先于范围宽的';
  return '新的优先于旧的';
}
