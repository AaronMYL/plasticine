export const LOOP_AREAS = ['note_predict', 'note_supplement', 'suggestion', 'ask', 'message_predict'] as const;
export type LoopArea = (typeof LOOP_AREAS)[number];
export const LOOP_OUTCOMES = ['kept', 'changed', 'rejected'] as const;
export type LoopOutcome = (typeof LOOP_OUTCOMES)[number];

export const MIN_DECIDED = 5;
export const OFFER_STREAK = 5;
export const COLD_RATE = 0.25;
export const WARM_RATE = 0.7;
export const COLD_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const TOPIC_MAX = 16;

export interface Tally {
  topic: string;
  kept: number;
  changed: number;
  rejected: number;
  decided: number;
  lastDecidedAt: string | null;
}

export type Temperature = 'unknown' | 'cold' | 'warm' | 'mixed';

export function keptRate(tally: Tally): number {
  return (tally.kept + 1) / (tally.decided + 2);
}

export function temperature(tally: Tally): Temperature {
  if (tally.decided < MIN_DECIDED) {
    return 'unknown';
  }
  const rate = keptRate(tally);
  return rate <= COLD_RATE ? 'cold' : rate >= WARM_RATE ? 'warm' : 'mixed';
}

export function streak(newestFirst: readonly LoopOutcome[]): number {
  let count = 0;
  for (const outcome of newestFirst) {
    if (outcome !== 'kept') {
      break;
    }
    count += 1;
  }
  return count;
}

export function normalizeTopic(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  return text === '' ? null : Array.from(text).slice(0, TOPIC_MAX).join('');
}

function topicKey(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function canonicalTopic(raw: string, known: readonly string[]): string | null {
  const name = normalizeTopic(raw);
  if (name === null) {
    return null;
  }
  const key = topicKey(name);
  if (key === '') {
    return name;
  }
  const same = known.find((topic) => topicKey(topic) === key);
  if (same !== undefined) {
    return same;
  }
  const near = known.find((topic) => {
    const other = topicKey(topic);
    const shorter = Math.min(Array.from(other).length, Array.from(key).length);
    return shorter >= 2 && (other.includes(key) || key.includes(other));
  });
  return near ?? name;
}

export function coldRetryDue(tally: Tally, now: Date): boolean {
  return tally.lastDecidedAt === null || now.getTime() - Date.parse(tally.lastDecidedAt) >= COLD_RETRY_MS;
}
