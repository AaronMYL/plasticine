// 记忆里规则的两个小件（11-11 第二步设计稿 M2）：来源怎么说、日子怎么写（规则搬家、说法冲突在用）。第13批旧规则页换成
// 规则搬家，只给旧页用的组件和小标都去掉了（11-14 Aaron 同意删）。

import type { SoulLine } from '../../api/shared.ts';

export const RULE_SOURCE_LABELS: Readonly<Record<SoulLine['source'], string>> = {
  user: '你说的', conversation: '你说的', inference: '你确认过', mate: '队友设定', system: '系统默认',
};

export function ruleDay(at: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at))
    .replace('/', '-');
}
