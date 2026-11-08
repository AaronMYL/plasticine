// 种来源实例和规则（docs/specs/things-and-sources.md 第 3.6、7.2 节第 2 步）：每种来源一个实例（iPhone 是设备种类的
// 另一个实例，第 4 批接上），六条规则带依据和版本 1。启动时补种，已有的不动（用户改过的档位、文字照旧）。
// 用户 11-02 改定：Plasticine 自己判断要做的事直接做，不走观察模式——规则种成自动档。
// 用户 11-04 改定（第 115 条）：信息流命中关注点不再开任务，feed_interest 种成关（线上由迁移 0050 改关）。
// 2026-11-05 Harness 重做：self_fix（修自己的失败，自迭代）、trial_feedback（试用反馈）两条删掉（迁移 0059 删行）；
// 其余规则命中时开一条后台线照规则文字去做。
// 用户 11-06 定（《优化清单》第 11 条）：这四条并进心跳的清单，统一由心跳处理，规则种成关（线上由迁移 0092 改关）。

import type { IntakeSourceKind, RuleInput } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export type SeedState = Pick<StateService, 'intakeSources' | 'rules' | 'transaction'>;

/** iPhone 的分享、拍照、语音、位置走这一个实例（第 4 批）；其余每种一个，label 就是界面上的名字。 */
export const IPHONE_SOURCE_LABEL = 'iPhone';

const SOURCES: readonly { kind: IntakeSourceKind; label: string; config?: Record<string, unknown> }[] = [
  { kind: 'dialog', label: '对话' },
  // 邮件读到哪仍记在 inbox_sync（MailSync），这里只指过去。
  { kind: 'mail', label: '邮件', config: { cursor: 'inbox_sync', recordOnlySenders: [] } },
  { kind: 'calendar', label: '日历' },
  { kind: 'feed', label: '信息流' },
  { kind: 'device', label: 'Mac' },
  { kind: 'device', label: IPHONE_SOURCE_LABEL },
  { kind: 'github', label: 'GitHub' },
  { kind: 'time', label: '时间' },
  { kind: 'system', label: '系统' },
  // 第 110 条：书签（手加、导入；信息流收藏 2026-11-04 起不再记成书签）。
  { kind: 'bookmark', label: '书签' },
  // 第 113 条：Cyber Hunter 网络上联系人的话（人话 w 0.5、AI 话 w 0.1），只当来源。
  { kind: 'contact', label: '联系人' },
];

export const RULE_CODES = ['project_overdue', 'meeting_invite', 'reply_needed', 'feed_interest'] as const;
export type RuleCode = (typeof RULE_CODES)[number];

const RULES: readonly RuleInput[] = [
  {
    code: 'project_overdue',
    name: '项目逾期、停滞两周提醒',
    text: '项目过了截止日期，或两周没有动静，发一句话邮件提醒。',
    sourceKinds: ['time', 'system'],
    triggerKinds: ['project.overdue', 'project.stalled'],
    mode: 'off',
    trialable: false,
    basisKind: 'decision',
    basisRef: '第 101 条',
    strength: 'explicit',
  },
  {
    code: 'meeting_invite',
    name: '会议邀请：先核日程、备回复草稿',
    text: '收到会议邀请，先核对那段时间的日程，备好回复草稿（不发出），等你点一下。',
    sourceKinds: ['mail', 'calendar'],
    triggerKinds: ['mail.calendar_invite', 'calendar.invite'],
    mode: 'off',
    trialable: true,
    basisKind: 'plasticine',
    basisRef: '第 102 条举例',
    strength: 'inferred',
  },
  {
    code: 'reply_needed',
    name: '他人来信需要回复：备草稿',
    text: '你认识的人来信，像是在等你回复时，备好回复草稿（不发出），等你点一下。',
    sourceKinds: ['mail'],
    triggerKinds: ['mail.known_sender'],
    mode: 'off',
    trialable: true,
    basisKind: 'plasticine',
    basisRef: null,
    strength: 'inferred',
  },
  {
    code: 'feed_interest',
    name: '信息流命中关注点：收进对应项目的待看',
    text: '信息流里命中关注点的条目，提议收进对应项目的待看（你点「用上」才写进项目）。',
    sourceKinds: ['feed'],
    triggerKinds: ['feed.interest_hit'],
    mode: 'off',
    trialable: true,
    basisKind: 'plasticine',
    basisRef: null,
    strength: 'inferred',
  },
];

export function ensureIntake(state: SeedState): void {
  state.transaction(() => {
    const existing = state.intakeSources.all();
    for (const source of SOURCES) {
      if (!existing.some((row) => row.kind === source.kind && row.label === source.label)) {
        state.intakeSources.create({ kind: source.kind, label: source.label, config: source.config ?? {} });
      }
    }
    for (const rule of RULES) {
      if (state.rules.byCode(rule.code) !== undefined) {
        continue;
      }
      const created = state.rules.create(rule);
      state.rules.addEvent({ ruleId: created.id, kind: 'created', toMode: created.mode, ruleVersion: 1,
        actor: 'migration', reason: '事与来源上线时种下（用户 11-02 定：直接自动，不走观察模式）' });
    }
  });
}
