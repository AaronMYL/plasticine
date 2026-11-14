// ?scene=memory（11-11 第二步）：两位虚构队友各带只对它的规则，「规则」里一条和「关于你」里一条说法冲突。
// 全是虚构的人和事。

import { SOUL_OWNER_MAIN } from '../shared.ts';
import type { FakeMates } from './fake-mates.ts';
import type { FakeSoul } from './fake-soul.ts';
import type { FakeSouls } from './fake-souls.ts';

export function seedMemoryScene({ mates, soul, souls }: { mates: FakeMates; soul: FakeSoul; souls?: FakeSouls },
  now: Date): void {
  // 第13批：只对某位队友的规则等着搬进它的 Soul（规则搬家截图用）；主线和研究员昨晚各自己改了一处（编辑弹框截图用）。
  const mateRules = (texts: readonly string[]) => (mate: { id: string }): void => soul.seedLines(texts.map((text,
    index) => ({ id: `scene-rule-${mate.id}-${String(index)}`, text, section: 'doing' as const, source: 'mate' as const,
    scopeKind: 'mate' as const, scopeRef: mate.id })));
  if (souls !== undefined) {
    souls.ensure(SOUL_OWNER_MAIN);
    souls.seedSelf(SOUL_OWNER_MAIN, `${souls.textOf(SOUL_OWNER_MAIN) ?? ''}\n\n## 说话\n- 讲到数字带上单位和出处。`,
      '这几天你两次追问数字从哪来，加了一条：讲到数字带上单位和出处。');
  }
  void mates.create({ requestId: 'scene-mate-research', name: '研究员', avatar: 'fox', hue: 'sky', role: '查资料、写周报',
    soul: '', purpose: null }).then((mate) => {
    mateRules(['报告里的数字都带来源链接。', '先列结论，再列依据。'])(mate);
    souls?.seedSelf(mate.id, `${souls.textOf(mate.id) ?? ''}\n\n## 性格\n- 较真，拿不准的数字宁可不写。`,
      '你说周报里有个数字没出处，加了一条性格：较真。');
  });
  void mates.create({ requestId: 'scene-mate-design', name: 'UI 设计师', avatar: 'curly', hue: 'rose', role: '出界面设计稿',
    soul: '', purpose: null }).then(mateRules(['设计稿里的数字用示例，标「示例」。']));
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
