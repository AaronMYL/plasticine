// 假的 /v2/heartbeat（《优化清单》第 11 条，设计稿 Tasks-Heartbeat）：清单、多久一次、最近几次在内存里；一句话改清单
// 照最简单的意思办——「别再看……」删掉说到的那一条，别的话加成一条。

import { ApiError } from '../errors.ts';
import type { HeartbeatItem, HeartbeatView, UpdateHeartbeatRequest } from '../shared.ts';

const DEFAULT_ITEMS: HeartbeatItem[] = [
  { id: 'mail', kind: 'mail', text: '要回复的邮件' },
  { id: 'calendar', kind: 'calendar', text: '接下来两小时的日历冲突' },
  { id: 'waiting', kind: 'waiting', text: '等你超过 4 小时的事' },
  { id: 'results', kind: 'results', text: '后台做完、你还没看的结果' },
  { id: 'friends', kind: 'friends', text: '朋友发来还没回的消息和任务卡' },
  { id: 'due', kind: 'due', text: '今天到期的项目待办' },
  { id: 'feed', kind: 'feed', text: '信息流里命中关注点的' },
];

export class FakeHeartbeat {
  private state: HeartbeatView = { enabled: true, nextAt: null, recent: [],
    config: { intervalMinutes: 30, quietFrom: '23:00', quietTo: '08:00', items: structuredClone(DEFAULT_ITEMS) } };
  private counter = 0;

  /** 设计稿里「最近」那三行。 */
  seed(now: Date): void {
    const at = (hour: number, minute: number): string => {
      const day = new Date(now);
      day.setHours(hour, minute, 0, 0);
      return day.toISOString();
    };
    this.state.nextAt = at(15, 0);
    this.state.recent = [
      { at: at(14, 30), note: '没事', failed: false },
      { at: at(14, 0), note: '「评审会」邀请要回复 → 发了消息给你', failed: false },
      { at: at(13, 30), note: '顺手起草了给小林的回复 → 在「等你」', failed: false },
    ];
  }

  setEnabled(on: boolean): void {
    this.state.enabled = on;
  }

  view(): HeartbeatView {
    return structuredClone(this.state);
  }

  update(body: Omit<UpdateHeartbeatRequest, 'requestId'>): HeartbeatView {
    const { config } = this.state;
    if (body.intervalMinutes !== undefined) {
      config.intervalMinutes = body.intervalMinutes;
    }
    if (body.items !== undefined) {
      config.items = body.items.map((item) => {
        const kept = item.id === undefined ? undefined : config.items.find((existing) => existing.id === item.id);
        this.counter += 1;
        return kept === undefined ? { id: `item-${this.counter}`, kind: 'custom', text: item.text.trim() }
          : { ...kept, text: item.text.trim() };
      });
    }
    return this.view();
  }

  say(text: string): HeartbeatView {
    const said = text.trim();
    const stop = /^(别再看|不用看|不看)(.+?)了?$/.exec(said);
    const { items } = this.state.config;
    if (stop === null) {
      return this.update({ items: [...items.map((item) => ({ id: item.id, text: item.text })), { text: said }] });
    }
    const topic = stop[2]!.replace(/了$/, '');
    const left = items.filter((item) => !item.text.includes(topic));
    if (left.length === items.length) {
      throw new ApiError({ kind: 'failed', code: 'invalid_input', message: '没听出要怎么改清单。', status: 422 });
    }
    return this.update({ items: left.map((item) => ({ id: item.id, text: item.text })) });
  }
}
