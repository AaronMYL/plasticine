// 采数事件点（《UI 方案》第 13 节：侧栏、对话栏、「它做了什么」这些的使用记录）。开关关着时一条都不发。
// 去处是内存里最近的几条（调试看）。2026-11-05 遥测上传和度量删了，不再往服务端送。

import { createContext, useContext } from 'react';

export const TELEMETRY_EVENTS = [
  'view.switched',
  'chat.collapsed',
  'chat.expanded',
  'conversation.sent',
  'run.details.opened',
  'note.quoted',
  // ≠ 标记点开比例（plasticine-visual / validation.md 的采数）。
  'disagreement.opened',
  // 回来汇报里每句被点开（《UI 方案》第 13 节：「新联系」被点开的比例，只数点开）。
  'return_brief.opened',
  // 第 111 条的度量线：Plasticine 自动放进某组的标签、其中被拿出来的（自动归组错率）；同一网址手输 3 次没加书签（漏收藏）。
  'tab_group.auto_added',
  'tab_group.auto_left',
  'bookmark.missed',
  // 沉浸式翻译的度量线（2026-11-03）：点「文A」到首屏段落全部回来的毫秒数；一页译完时的字数和缓存命中的字数。
  'translate.first_screen',
  'translate.page',
] as const;

export type TelemetryName = (typeof TELEMETRY_EVENTS)[number];

export type TelemetryPayload = Record<string, string | number | boolean>;

export interface TelemetryRecord {
  name: TelemetryName;
  occurredAt: string;
  payload: TelemetryPayload;
}

export type TelemetrySink = (record: TelemetryRecord) => void;

/** 内存里只留最近这么多条，够调试看，不无限长。 */
const MEMORY_LIMIT = 200;

export function memorySink(records: TelemetryRecord[]): TelemetrySink {
  return (record) => {
    records.push(record);
    if (records.length > MEMORY_LIMIT) {
      records.shift();
    }
  };
}

export class Telemetry {
  private enabled: boolean;
  private readonly sink: TelemetrySink;
  private readonly now: () => Date;
  /** 登录之后的上报（telemetry-upload.ts）也听着；开关关着时谁都收不到。 */
  private readonly listeners = new Set<TelemetrySink>();

  /** 返回取消监听的函数。 */
  onRecord(listener: TelemetrySink): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  constructor(sink: TelemetrySink, enabled: boolean, now: () => Date = () => new Date()) {
    this.sink = sink;
    this.enabled = enabled;
    this.now = now;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  track(name: TelemetryName, payload: TelemetryPayload = {}): void {
    if (!this.enabled) {
      return;
    }
    const record = { name, occurredAt: this.now().toISOString(), payload };
    this.sink(record);
    for (const listener of [...this.listeners]) {
      listener(record);
    }
  }
}

const DISABLED = new Telemetry(() => undefined, false);

export const TelemetryContext = createContext<Telemetry>(DISABLED);

export function useTelemetry(): Telemetry {
  return useContext(TelemetryContext);
}
