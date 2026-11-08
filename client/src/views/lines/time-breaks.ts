// 消息之间按时间加分隔（《优化清单》第 17 条借鉴 Muse，设计稿「11月7日 10:51」）：换了一天、或和上一条隔了半小时以上，
// 这一条上面出一条细线 + 时间；挨着说的不出。没有时间的（子线卡片之外的东西）跟着上一条。

/** 隔这么久就再标一次时间：聊天里「过了一阵」的感觉。 */
export const TIME_BREAK_MS = 30 * 60 * 1000;

function dayOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

export function timeLabel(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';
  return `${Number(part('month'))}月${Number(part('day'))}日 ${part('hour')}:${part('minute')}`;
}

/** 每一项上面要不要出时间分隔：要就是那一行字，不要是 null。 */
export function timeBreaks(items: readonly { at: string | null }[], timeZone: string): (string | null)[] {
  let previous: string | null = null;
  return items.map((item) => {
    if (item.at === null) {
      return null;
    }
    const gap = previous === null ? Number.POSITIVE_INFINITY : Date.parse(item.at) - Date.parse(previous);
    const newDay = previous === null || dayOf(previous, timeZone) !== dayOf(item.at, timeZone);
    previous = item.at;
    return newDay || gap >= TIME_BREAK_MS ? timeLabel(item.at, timeZone) : null;
  });
}
