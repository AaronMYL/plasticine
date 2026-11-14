// 记忆里规则的几个小件（11-11 第二步设计稿 M2）：来源怎么说、日子怎么写（规则搬家、说法冲突在用），「只对哪位队友」的
// 小标。第13批旧规则页（一行和详情、改和删）换成规则搬家，那几个组件去掉了；小标和 ruleMate 现在没人用，删要先问 Aaron。

import type { ReactNode } from 'react';
import type { MateView, SoulLine } from '../../api/shared.ts';
import { MateAvatar } from '../mates/mate-avatar.tsx';

export const RULE_SOURCE_LABELS: Readonly<Record<SoulLine['source'], string>> = {
  user: '你说的', conversation: '你说的', inference: '你确认过', mate: '队友设定', system: '系统默认',
};

export function ruleDay(at: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at))
    .replace('/', '-');
}

export function ruleMate(line: SoulLine, mates: readonly MateView[]): MateView | undefined {
  return line.scopeKind === 'mate' ? mates.find((mate) => mate.id === line.scopeRef) : undefined;
}

export function ScopeChip({ line, mates }: { line: SoulLine; mates: readonly MateView[] }): ReactNode {
  if (line.scopeKind !== 'mate') return null;
  const mate = ruleMate(line, mates);
  return <span className="rule-chip">{mate === undefined ? null : <MateAvatar mate={mate} size={16} still />}
    只对{mate?.name ?? '一位队友'}</span>;
}
