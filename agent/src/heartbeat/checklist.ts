// 心跳的清单（《优化清单》第 11 条，11-06 定）：一张很短的清单，放在库里（timed_slots 的 heartbeat 那一行），更新不碰。
// 默认七条：前六条他定的，最后一条是原来「信息流命中关注点」那条规则并进来的（会议邀请、要回复并进「要回复的邮件」，
// 项目逾期并进「今天到期的项目待办」）。他能拖、能删、能加；他自己加的那条没有代码筛，有变化时交给模型一起看。

import { Value } from 'typebox/value';
import {
  HEARTBEAT_ITEMS_MAX,
  HeartbeatConfigSchema,
  type HeartbeatConfig,
  type HeartbeatItem,
  type HeartbeatItemKind,
} from '../../shared/api/index.ts';

export const DEFAULT_ITEMS: readonly HeartbeatItem[] = [
  { id: 'mail', kind: 'mail', text: '要回复的邮件' },
  { id: 'calendar', kind: 'calendar', text: '接下来两小时的日历冲突' },
  { id: 'waiting', kind: 'waiting', text: '等你超过 4 小时的事' },
  { id: 'results', kind: 'results', text: '后台做完、你还没看的结果' },
  { id: 'friends', kind: 'friends', text: '朋友发来还没回的消息和任务卡' },
  { id: 'due', kind: 'due', text: '今天到期的项目待办' },
  { id: 'feed', kind: 'feed', text: '信息流里命中关注点的' },
];

/** 每 30 分钟；23:00–08:00 不跳（11-06 定）。 */
export const DEFAULT_CONFIG: HeartbeatConfig = {
  intervalMinutes: 30,
  quietFrom: '23:00',
  quietTo: '08:00',
  items: [...DEFAULT_ITEMS],
};

/** 库里那份读出来；坏了（手改坏、旧版本）就用默认，不让心跳停。 */
export function readConfig(raw: Record<string, unknown>): HeartbeatConfig {
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return Value.Check(HeartbeatConfigSchema, merged) ? merged : { ...DEFAULT_CONFIG, items: [...DEFAULT_ITEMS] };
}

export class ChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecklistError';
  }
}

/**
 * 整份换掉（拖过、删过、加过）：留下来的认原来的种类；新加的认成默认里同名的那条，不然是他自己加的（custom）。
 */
export function replaceItems(current: readonly HeartbeatItem[], next: readonly { id?: string; text: string }[],
  newId: () => string): HeartbeatItem[] {
  if (next.length > HEARTBEAT_ITEMS_MAX) {
    throw new ChecklistError(`清单最多 ${HEARTBEAT_ITEMS_MAX} 条，要短。`);
  }
  return next.map((item) => {
    const text = item.text.trim();
    const kept = item.id === undefined ? undefined : current.find((existing) => existing.id === item.id);
    if (kept !== undefined) {
      return { ...kept, text };
    }
    const builtin = DEFAULT_ITEMS.find((existing) => existing.text === text);
    if (builtin !== undefined && !current.some((existing) => existing.id === builtin.id)) {
      return { ...builtin };
    }
    return { id: newId(), kind: 'custom' as HeartbeatItemKind, text };
  });
}

/** 一句话改清单时模型给的改法，代码校验后才落。 */
export interface ChecklistEdit {
  remove: string[];
  add: string[];
}

export function applyEdit(current: readonly HeartbeatItem[], edit: ChecklistEdit, newId: () => string)
  : HeartbeatItem[] {
  const kept = current.filter((item) => !edit.remove.includes(item.id));
  const added = edit.add.map((text) => ({ text }));
  return replaceItems(current, [...kept.map((item) => ({ id: item.id, text: item.text })), ...added], newId);
}
