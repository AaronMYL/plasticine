import type { SoulLine } from '../../api/shared.ts';

export const RULE_SOURCE_LABELS: Readonly<Record<SoulLine['source'], string>> = {
  user: '你说的', conversation: '你说的', inference: '你确认过', mate: '队友设定', system: '系统默认',
};

export function ruleDay(at: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at))
    .replace('/', '-');
}
