import type { MemoryDoc, MemoryLine } from '../../../shared/state.ts';
import { siteKey, type StateService } from '../../state/index.ts';

export type RecallState = Pick<StateService, 'memoryDocs'>;

export const RECALL_MAX_CHARS = 1_500;
const RESULT_SCAN_CHARS = 2_000;

const TITLE_SITES: readonly (readonly [string, readonly string[]])[] = [
  ['小红书', ['xiaohongshu.com']],
  ['抖音', ['douyin.com']],
  ['BOSS', ['zhipin.com']],
  ['公众号', ['mp.weixin.qq.com']],
  ['微博', ['weibo.com']],
  ['知乎', ['zhihu.com']],
  ['B站', ['bilibili.com']],
  ['哔哩哔哩', ['bilibili.com']],
  ['Reddit', ['reddit.com']],
  ['GitHub', ['github.com']],
  ['推特', ['x.com', 'twitter.com']],
  ['闲鱼', ['goofish.com']],
  ['淘宝', ['taobao.com']],
  ['京东', ['jd.com']],
  ['飞书', ['feishu.cn']],
];

export interface RecallCall {
  name: string;
  args: unknown;
}

function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((match) => match[1] ?? '');
}

function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (depth > 3 || typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.values(value).flatMap((item) => stringsIn(item, depth + 1));
}

function hostKeys(host: string): string[] {
  const key = siteKey(host);
  const parts = key.split('.');
  return parts.length > 2 ? [key, parts.slice(-2).join('.'), parts.slice(-3).join('.')] : [key];
}

export function touchedKeys(call: RecallCall, resultText: string): string[] {
  const args = typeof call.args === 'object' && call.args !== null ? call.args : {};
  const action: unknown = Reflect.get(args, 'action');
  const app = [Reflect.get(args, 'app'), typeof action === 'object' && action !== null ? Reflect.get(action, 'app')
    : undefined].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  const hosts = [...stringsIn(args).flatMap(urlsIn), ...urlsIn(resultText.slice(0, RESULT_SCAN_CHARS)).slice(0, 2)];
  return [...new Set([...hosts.flatMap(hostKeys), ...app.map((name) => name.trim())])];
}

function titleSites(title: string): string[] {
  return TITLE_SITES.filter(([name]) => title.includes(name)).flatMap(([, sites]) => sites);
}

export function experienceDocsFor(state: RecallState, keys: readonly string[]): MemoryDoc[] {
  if (keys.length === 0) {
    return [];
  }
  const ids = new Set(state.memoryDocs.usage.docsFor('how', keys));
  const byTitle = state.memoryDocs.docs.live().filter((doc) => doc.kind === 'how' && !ids.has(doc.id)
    && (state.memoryDocs.usage.get(doc.id)?.sites.length ?? 0) === 0
    && titleSites(doc.title).some((site) => keys.includes(site)));
  return [...[...ids].flatMap((id) => {
    const doc = state.memoryDocs.docs.get(id);
    return doc === undefined ? [] : [doc];
  }), ...byTitle];
}

function docText(doc: MemoryDoc, lines: readonly MemoryLine[]): string {
  const head = `［做事经验「${doc.title}」：以前在这里试出来的，接下来照着做；和眼前看到的对不上就以眼前为准，`
    + '做完用 note_experience 改那一行］';
  const shown: string[] = [];
  let used = Array.from(head).length;
  for (const line of lines) {
    const text = `- ${line.section === 'avoid' ? '别：' : ''}${line.text}`;
    used += Array.from(text).length;
    if (used > RECALL_MAX_CHARS) {
      shown.push(`- 还有 ${lines.length - shown.length} 条，用 read_memory_doc 读「${doc.title}」`);
      break;
    }
    shown.push(text);
  }
  return [head, ...shown].join('\n');
}

export function recallExperience(state: RecallState, call: RecallCall, resultText: string, shown: Set<string>)
  : string | null {
  const docs = experienceDocsFor(state, touchedKeys(call, resultText)).filter((doc) => !shown.has(doc.id));
  const parts: string[] = [];
  for (const doc of docs) {
    const lines = state.memoryDocs.lines.live(doc.id);
    shown.add(doc.id);
    if (lines.length === 0) {
      continue;
    }
    state.memoryDocs.usage.used(doc.id);
    parts.push(docText(doc, lines));
  }
  return parts.length === 0 ? null : parts.join('\n\n');
}
