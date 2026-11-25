import { Value } from 'typebox/value';
import {
  PagePerceptionSchema,
  WEB_PAGE_TEXT_MAX_CHARS,
  WebPageSnapshotSchema,
  type PagePerception,
  type WebPageSnapshot,
} from '../../api/shared.ts';
import type { Quote } from '../../api/types.ts';
import { hostWebTabs } from '../../shell/host.ts';
import type { CurrentGroup, CurrentTab } from '../../shell/current-tab-context.ts';
import { routeHash } from '../../shell/routes.ts';

export function pageQuoteText(snapshot: WebPageSnapshot, maxChars = WEB_PAGE_TEXT_MAX_CHARS): string {
  const chars = Array.from(snapshot.text);
  const keptChars = Math.min(chars.length, maxChars);
  const kept = keptChars < chars.length ? chars.slice(0, keptChars).join('') : snapshot.text;
  const total = Math.max(snapshot.totalChars, chars.length);
  const note = snapshot.truncated || total > keptChars ? `\n\n〔这一页正文共 ${total.toLocaleString('zh-CN')} 字，`
    + `只带上了前 ${keptChars.toLocaleString('zh-CN')} 字〕` : '';
  const title = snapshot.title === '' ? snapshot.url : snapshot.title;
  return `${title}\n${snapshot.url}\n\n${kept}${note}`;
}

export async function readPageSnapshot(tabId: string): Promise<WebPageSnapshot | null> {
  const bridge = hostWebTabs();
  if (bridge === null) {
    return null;
  }
  const snapshot: unknown = await bridge.snapshot(tabId);
  if (!Value.Check(WebPageSnapshotSchema, snapshot)) {
    throw new Error('原生层回的网页正文格式不对');
  }
  return snapshot;
}

export function perceptionQuoteText(perception: PagePerception, tabId: string, maxChars: number): string {
  const chars = Array.from(perception.outline);
  const kept = chars.length > maxChars ? chars.slice(0, maxChars).join('') : perception.outline;
  const total = Math.max(perception.totalChars, chars.length);
  const cut = perception.truncated || total > Math.min(chars.length, maxChars)
    ? `\n\n〔这一页结构共 ${total.toLocaleString('zh-CN')} 字，只带上了前 ${Math.min(chars.length, maxChars)
      .toLocaleString('zh-CN')} 字；后面的翻页再看〕` : '';
  const pictures = perception.imageHeavy ? '\n〔这一页以图为主，字读不出多少：要看懂得截图〕' : '';
  const title = perception.title === '' ? perception.url : perception.title;
  const how = `〔网页标签 tabId=${tabId}，元素编号这一版 version=${perception.version}：要在这一页上做事，用 Mac 的 `
    + 'device_action tab_act 按编号点、填、选、翻页；提交前先问他〕';
  return `${title}\n${perception.url}\n${how}${pictures}\n\n${kept}${cut}`;
}

export async function readPagePerception(tabId: string): Promise<PagePerception | null> {
  const bridge = hostWebTabs();
  if (bridge === null || bridge.tool === undefined || !(bridge.tools ?? []).includes('perceive')) {
    return null;
  }
  const raw: unknown = await bridge.tool(tabId, { kind: 'perceive' });
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Value.Check(PagePerceptionSchema, parsed)) {
    throw new Error('原生层回的页面结构格式不对');
  }
  return parsed;
}

type Page = Omit<CurrentTab, 'group'>;

function pageSource(tab: Page): string {
  return tab.url ?? (tab.route === null ? tab.id : routeHash(tab.route));
}

function plainText(tab: Page): string {
  return tab.url === null ? `${tab.title}（${pageSource(tab)}）` : `${tab.title}\n${tab.url}`;
}

export interface PageQuoteResult {
  quote: Quote;
  title: string;
  scope: string;
  failed: boolean;
}

type PageText = Omit<PageQuoteResult, 'quote'> & { text: string };

async function pageText(tab: Page, maxChars: number): Promise<PageText> {
  const title = tab.title || tab.url || '未命名';
  const plain = { text: plainText(tab), title, scope: '仅标题和链接', failed: false };
  if (tab.kind !== 'web') return plain;
  try {
    const perception = await readPagePerception(tab.id);
    if (perception !== null) {
      const cut = perception.truncated || Array.from(perception.outline).length > maxChars;
      return { text: perceptionQuoteText(perception, tab.id, maxChars), failed: false,
        title: perception.title || title, scope: cut ? '部分页面结构' : '页面结构' };
    }
  } catch (cause) {
    console.warn('没能感知这一页的结构，改读正文', cause);
  }
  try {
    const snapshot = await readPageSnapshot(tab.id);
    if (snapshot === null) return plain;
    const cut = snapshot.truncated || Math.max(snapshot.totalChars, Array.from(snapshot.text).length) > maxChars;
    const scope = snapshot.text.trim() === '' ? '仅标题和链接' : cut ? '部分可见正文' : '可见正文';
    return { text: pageQuoteText(snapshot, maxChars), failed: false, title: snapshot.title || title, scope };
  } catch (cause) {
    console.warn('没能读到这一页的正文', cause);
    return { ...plain, failed: true };
  }
}

export function titlePageQuote(tab: CurrentTab): PageQuoteResult {
  const source = pageSource(tab);
  const title = tab.title || tab.url || '未命名';
  return { title, failed: false, scope: '仅标题和链接', quote: { id: `quote_tab_${source}_title`,
    kind: 'object', sourceId: source, label: title, text: `${plainText(tab)}\n〔仅引用标题和链接，未读取正文〕` } };
}

export async function groupQuote(group: CurrentGroup): Promise<{ quote: Quote; failed: string[] }> {
  const budget = Math.floor(WEB_PAGE_TEXT_MAX_CHARS / Math.max(1, group.tabs.length));
  const parts = await Promise.all(group.tabs.map((tab) => pageText(tab, budget)));
  const failed = group.tabs.filter((_tab, index) => parts[index]!.failed).map((tab) => tab.title);
  const body = group.tabs.map((tab, index) => {
    const part = parts[index]!;
    const missing = part.failed ? '\n〔没读到这一页的正文，只带上了标题和网址〕' : '';
    return `—— 第 ${index + 1} 页：${tab.title}\n${part.text}${missing}`;
  }).join('\n\n');
  const label = `${group.name} · ${group.tabs.length} 页`;
  return { failed, quote: { id: `quote_group_${group.id}_${group.tabs.map((tab) => tab.id).join(',')}`,
    kind: 'object', sourceId: group.id, label, text: `「${group.name}」这一组 ${group.tabs.length} 页\n\n${body}` } };
}

export async function currentPageQuote(tab: CurrentTab, contactText: string | null,
  maxChars: number): Promise<PageQuoteResult> {
  const source = pageSource(tab);
  const part = contactText === null ? await pageText(tab, Math.min(maxChars, WEB_PAGE_TEXT_MAX_CHARS))
    : { text: contactText, failed: false, title: tab.title, scope: '最近对话与任务' };
  return { failed: part.failed, title: part.title, scope: part.scope,
    quote: { id: `quote_tab_${source}`, kind: 'object', sourceId: source, label: part.title, text: part.text } };
}
