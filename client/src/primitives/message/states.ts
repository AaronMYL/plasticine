export type UserState = 'sent' | 'sending' | 'uncertain' | 'unsent' | 'failed';

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
