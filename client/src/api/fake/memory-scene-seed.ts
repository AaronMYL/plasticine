// ?scene=memory（11-11 第二步）：两位虚构队友各带只对它的规则，「规则」里一条和「关于你」里一条说法冲突。
// 全是虚构的人和事。

import type { FakeMates } from './fake-mates.ts';
import type { FakeSoul } from './fake-soul.ts';

export function seedMemoryScene({ mates, soul }: { mates: FakeMates; soul: FakeSoul }, now: Date): void {
  void mates.create({ requestId: 'scene-mate-research', name: '研究员', avatar: '研', hue: 'sky', role: '查资料、写周报',
    soul: '- 报告里的数字都带来源链接。\n- 先列结论，再列依据。', purpose: null });
  void mates.create({ requestId: 'scene-mate-design', name: 'UI 设计师', avatar: '设', hue: 'rose', role: '出界面设计稿',
    soul: '- 设计稿里的数字用示例，标「示例」。', purpose: null });
  const at = now.toISOString();
  soul.seedLines([{ id: 'scene-rule-weekend', text: '周末不发等我决定的卡。', section: 'doing', source: 'inference',
    scopeKind: 'all', scopeRef: null }]);
  soul.seedConflicts([{ id: 'scene-conflict-weekend', version: 1, title: '周末的提醒', winnerId: 'scene-you-weekend',
    reason: '你说的优先于你确认过的推断', createdAt: at, lines: [
      { id: 'scene-rule-weekend', text: '周末不发等我决定的卡。', docId: 'rules', docTitle: '规则', source: 'confirmed',
        scope: '全部', at },
      { id: 'scene-you-weekend', text: '周末照常提醒到期事项。', docId: 'you', docTitle: '关于你', source: 'said',
        scope: '全部', at },
    ] }]);
}
