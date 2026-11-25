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
