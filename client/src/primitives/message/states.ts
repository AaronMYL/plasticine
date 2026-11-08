// 消息原语的状态和几条显示规则（component-recipes.md「1. 消息」）。

/** 你的话：已存下 / 发送中 / 结果待核实 / 核实过没送到 / 明确失败。用户消息不折叠。 */
export type UserState = 'sent' | 'sending' | 'uncertain' | 'unsent' | 'failed';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** 「Plasticine 做了什么 · n 个动作 · 时长」里的时长。 */
export function formatDuration(ms: number): string {
  if (ms < SECOND_MS) {
    return '不到 1 秒';
  }
  if (ms < MINUTE_MS) {
    return `${Math.round(ms / SECOND_MS)} 秒`;
  }
  if (ms < HOUR_MS) {
    return `${Math.round(ms / MINUTE_MS)} 分钟`;
  }
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
}

/** 消息头上的时间：按本机时区显示时分。 */
export function formatClock(iso: string, withDate = false, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '时间未知';
  }
  if (withDate || timeZone !== undefined) {
    return new Intl.DateTimeFormat('zh-CN', {
      ...(withDate ? ({ month: 'numeric', day: 'numeric' } as const) : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(date);
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatDay(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '日期未知';
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', timeZone })
    .format(date)
    .replace('月', ' 月 ')
    .replace('日', ' 日');
}

/** datetime-local 不带时区，先按用户时区拆成表单字段。 */
export function timeInput(iso: string | null, timeZone: string): string {
  if (iso === null || Number.isNaN(Date.parse(iso))) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function fromTimeInput(value: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const local = Date.parse(`${value}Z`);
  if (Number.isNaN(local)) {
    return null;
  }
  let instant = local;
  // 校正时区偏移后再核验一次，夏令时缺失的一小时不得静默挪到别的时间。
  const MAX_OFFSET_PASSES = 4;
  for (let i = 0; i < MAX_OFFSET_PASSES; i += 1) {
    const shown = timeInput(new Date(instant).toISOString(), timeZone);
    if (shown === value) {
      return new Date(instant).toISOString();
    }
    instant += local - Date.parse(`${shown}Z`);
  }
  return null;
}

export const USER_STATE_TEXT: Record<Exclude<UserState, 'sent'>, string> = {
  sending: '发送中',
  uncertain: '结果待核实',
  unsent: '没有送到',
  failed: '没发出去',
};
