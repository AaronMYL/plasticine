// 旧空间按新版式重写（第 8 批第 6 条，他 11-09 定「旧空间按新版式让 Plasticine 重写一遍」）：内容和数字不变，只重排；
// 个人回顾的各期写成来信，别的写成报告；重写前的版本留在历史（space_revisions）里。要调模型，不能放进迁移：做成服务
// 起来以后的一次性后台活（登记成一个扫描，每个进程只跑一遍），找还没有网页版的空间一个一个重写：
// - 做成了在 space_rewrites 记下，重启不再做；
// - 没做成（模型出错、写不全、数字对不上、清洗后不合规）留着旧版、记一次，下次启动再试；试满 REWRITE_ATTEMPTS_MAX 次
//   就不再试（旧版照旧能看），免得每次重启都花一遍模型。
// 一次一个空间一次模型调用（来信另加一次出图）。

import type { Space, SpaceDoc, SpaceGenre } from '../../shared/state.ts';
import type { Illustrator, IllustrationMime, TextModels } from '../kernel/index.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { illustrate } from './illustrate.ts';
import { LETTER_GUIDE, REPORT_GUIDE, SPACE_RULES } from './space-guide.ts';
import { writeSpace } from './writes.ts';

export type RewriteState = Pick<StateService, 'spaces' | 'subscriptions' | 'spaceRewrites' | 'transaction'>;

/** 一个空间最多试这么多次（每次是一次服务启动）。 */
export const REWRITE_ATTEMPTS_MAX = 3;
// 一页报告重写出来常有一两万字符（内联的图表占得多）：给够输出，写不全就算没做成。
const OUTPUT_TOKENS = 32_000;
const REASON_MAX_CHARS = 200;
export const REWRITE_CHANGE = '按新版式重写';

export interface RewriteOptions {
  state: RewriteState;
  text: TextModels;
  illustrator: Illustrator | null;
  saveAsset: (data: Buffer, mime: IllustrationMime) => string;
}

export interface RewriteResult {
  done: string[];
  failed: { spaceId: string; reason: string }[];
}

function genreOf(state: RewriteState, space: Space): SpaceGenre {
  const subscription = space.subscriptionId === null ? undefined : state.subscriptions.get(space.subscriptionId);
  return subscription?.kind === 'review' ? 'letter' : 'report';
}

function systemPrompt(genre: SpaceGenre): string {
  return [
    '你是 Plasticine。他把空间改成了整页网页，旧的空间要按新版式重写一遍。',
    '规矩：内容和数字一个都不改、不删、不加新的说法，只换排版；出处、链接、图表数据照旧（图表改用现成的类或内联 SVG 画，',
    '数照原文）。只输出 body 里的 html 片段本身，不要解释、不要代码块标记。',
    SPACE_RULES,
    genre === 'letter'
      ? `${LETTER_GUIDE}\n这是一期个人回顾，重写成来信：原来的小节改成连贯的段落，第一段落到他的事，最后一段是原文里的下一步。`
      : REPORT_GUIDE,
  ].join('\n');
}

function userPrompt(space: Space, genre: SpaceGenre): string {
  return [
    `空间《${space.title}》（${genre === 'letter' ? '重写成来信' : '重写成报告'}）。旧版的结构化正文（JSON）：`,
    JSON.stringify(space.doc),
  ].join('\n');
}

/** 模型偶尔还是会包一层 ```html：去掉。 */
function unfenced(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

/** 来信的题目由信纸套上：模型照旧写了一个 h1 就去掉（不为这个白花一次重写）。 */
function withoutTitle(html: string): string {
  return html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi, '').trim();
}

/** 旧版里一定要在新版里找得到的数：数字卡和图表的数据（正文里的数交给模型照抄）。 */
export function requiredNumbers(doc: SpaceDoc): string[] {
  const found = new Set<string>();
  const add = (value: string | number): void => {
    for (const match of String(value).matchAll(/\d+(?:\.\d+)?/g)) {
      found.add(match[0]);
    }
  };
  doc.stats.forEach((stat) => add(stat.value));
  for (const block of doc.blocks) {
    if (block.type === 'chart') {
      block.series.forEach((series) => series.values.forEach(add));
    }
  }
  return [...found];
}

function missingNumbers(doc: SpaceDoc, html: string): string[] {
  const flat = html.replace(/(\d),(\d{3})/g, '$1$2');
  return requiredNumbers(doc).filter((number) => !new RegExp(`(^|[^\\d.])${number.replace('.', '\\.')}(?![\\d])`)
    .test(flat));
}

function clip(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= REASON_MAX_CHARS ? chars.join('') : `${chars.slice(0, REASON_MAX_CHARS - 1).join('')}…`;
}

export class SpaceRewriter {
  readonly #options: RewriteOptions;
  #running: Promise<RewriteResult> | null = null;
  #finished = false;

  constructor(options: RewriteOptions) {
    this.#options = options;
  }

  /** 还要重写的：没有网页版、没做成过、没试满次数。 */
  pending(): Space[] {
    const { state } = this.#options;
    return state.spaces.withoutPage().filter((space) => {
      const record = state.spaceRewrites.get(space.id);
      return record === undefined || (record.doneAt === null && record.attempts < REWRITE_ATTEMPTS_MAX);
    });
  }

  /** 每个进程只跑一遍（扫描每轮都会叫它）：跑过了什么都不做，正在跑就等那一遍。 */
  once(signal: AbortSignal = new AbortController().signal): Promise<RewriteResult> | null {
    if (this.#finished) {
      return null;
    }
    this.#running ??= this.run(signal).finally(() => {
      this.#finished = true;
    });
    return this.#running;
  }

  async run(signal: AbortSignal): Promise<RewriteResult> {
    const result: RewriteResult = { done: [], failed: [] };
    for (const space of this.pending()) {
      if (signal.aborted) {
        break;
      }
      try {
        await this.#rewrite(space, signal);
        this.#options.state.spaceRewrites.done(space.id);
        result.done.push(space.id);
      } catch (error) {
        const reason = clip(error instanceof Error ? error.message : String(error));
        this.#options.state.spaceRewrites.failed(space.id, reason);
        result.failed.push({ spaceId: space.id, reason });
        safeLog('error', 'space_rewrite_failed', { objectId: space.id, category: errorCategory(error) });
      }
    }
    return result;
  }

  async #rewrite(space: Space, signal: AbortSignal): Promise<void> {
    const { state, text } = this.#options;
    const genre = genreOf(state, space);
    const answer = await text.ask({ purpose: genre === 'letter' ? 'review' : 'researcher', system: systemPrompt(genre),
      messages: [{ role: 'user', content: userPrompt(space, genre) }], maxOutputTokens: OUTPUT_TOKENS }, signal);
    if (!answer.complete) {
      throw new Error('模型写到长度上限，没写完');
    }
    let html = unfenced(answer.text);
    if (genre === 'letter') {
      html = (await illustrate(withoutTitle(html), { illustrator: this.#options.illustrator,
        save: this.#options.saveAsset, signal })).html;
    }
    const missing = missingNumbers(space.doc, html);
    if (missing.length > 0) {
      throw new Error(`重写后少了旧版里的数：${missing.slice(0, 5).join('、')}`);
    }
    const current = state.spaces.require(space.id);
    if (current.html !== null || current.deletedAt !== null) {
      return;
    }
    writeSpace(state, { id: current.id, version: current.version, title: current.title, genre, html,
      change: REWRITE_CHANGE }, 'ai');
  }
}
