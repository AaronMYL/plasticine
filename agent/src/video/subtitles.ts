// 作品自带字幕 → 逐字稿（《优化清单》第 9 条：别的网站的视频先用自带字幕，没有再本地转写；抖音视频 11-09 起直接转写）。srt、vtt 按时间轴读；抖音自带字幕是
// JSON（一组带起止时间的句子，字段名各版本不一：text / content、start_time / start / startTime，毫秒或秒）。
// 逐字稿每句一行，前面带 [分:秒]，相邻同一句的重复（vtt 滚动字幕）去掉。

export interface TranscriptLine {
  /** 起点，秒。 */
  start: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string): number {
  const match = TIME.exec(stamp);
  if (match === null) {
    return 0;
  }
  const [, hours, minutes, secs, fraction] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(secs) + Number(`0.${fraction ?? '0'}`);
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
}

function parseCues(text: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const timing = rows.findIndex((row) => row.includes('-->'));
    if (timing < 0) {
      continue;
    }
    const body = stripTags(rows.slice(timing + 1).join(' '));
    if (body !== '') {
      lines.push({ start: seconds(rows[timing]?.split('-->')[0] ?? ''), text: body });
    }
  }
  return lines;
}

function field(entry: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) {
    if (entry[name] !== undefined) {
      return entry[name];
    }
  }
  return undefined;
}

function parseJson(text: string): TranscriptLine[] {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : findArray(parsed);
  const lines: TranscriptLine[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const body = field(entry, ['text', 'content', 'utterance']);
    const start = Number(field(entry, ['start_time', 'startTime', 'start', 'begin']) ?? 0);
    if (typeof body === 'string' && body.trim() !== '') {
      // 大于一万的当毫秒（一条视频不会有近三小时的字幕起点写成秒）。
      lines.push({ start: start > 10_000 ? start / 1000 : start, text: body.trim() });
    }
  }
  return lines;
}

function findArray(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  for (const key of ['utterances', 'captions', 'subtitles', 'body', 'data']) {
    const inner = (value as Record<string, unknown>)[key];
    if (Array.isArray(inner)) {
      return inner;
    }
  }
  return [];
}

export function parseSubtitle(text: string, format: 'srt' | 'vtt' | 'json'): TranscriptLine[] {
  const lines = format === 'json' ? parseJson(text) : parseCues(text);
  return lines.filter((line, index) => index === 0 || line.text !== lines[index - 1]?.text);
}

function stamp(start: number): string {
  const whole = Math.max(0, Math.floor(start));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** 逐字稿：每句一行，前面带 [分:秒]。 */
export function transcriptText(lines: readonly TranscriptLine[]): string {
  return lines.map((line) => `[${stamp(line.start)}] ${line.text}`).join('\n');
}
