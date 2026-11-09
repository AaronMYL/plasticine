// 来信的插图（第 8 批第 6 条）：模型在正文里写一个占位 <figure class="lt-fig" data-illustrate="画面描述">（带图注），
// 这里照画面描述出一张图、存成 Plasticine 自己的资产（和笔记里的图同一处，/v2/notes/assets/<名字>），把占位换成
// <img>，图注后面标「Plasticine 生成」。出不了图就把整个占位去掉：这封信不配图，信照样写。一封信只画一张。

import type { Illustrator, IllustrationMime } from '../kernel/index.ts';
import { decodeEntities, escapeHtmlAttribute } from '../../shared/space-html.ts';

const PLACEHOLDER = /<figure\b([^>]*)\bdata-illustrate\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>([\s\S]*?)<\/figure>/gi;
const CAPTION_END = /<\/figcaption>/i;
const PROMPT_MAX_CHARS = 1_000;
export const ASSET_PATH = '/v2/notes/assets/';
export const ILLUSTRATION_CREDIT = 'Plasticine 生成';

export interface IllustrateOptions {
  illustrator: Illustrator | null;
  /** 存成资产，回资产名。 */
  save: (data: Buffer, mime: IllustrationMime) => string;
  signal: AbortSignal;
}

export interface Illustrated {
  html: string;
  /** 配上了（资产名）、没配（原因）、正文里本来就没有占位（null）。 */
  outcome: { asset: string } | { skipped: string } | null;
}

function figureWith(match: RegExpExecArray, src: string, alt: string): string {
  const attrs = `${match[1] ?? ''}${match[5] ?? ''}`.replace(/\s+/g, ' ').trimEnd();
  const inner = match[6] ?? '';
  const credit = `<span class="lt-credit">${ILLUSTRATION_CREDIT}</span>`;
  const caption = CAPTION_END.test(inner) ? inner.replace(CAPTION_END, `${credit}</figcaption>`)
    : `${inner}<figcaption>${credit}</figcaption>`;
  const image = `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}">`;
  return `<figure${attrs}>${image}${caption}</figure>`;
}

/** 有占位就画第一张；其余的占位（一封信只配一张）和画不出来的都去掉。 */
export async function illustrate(html: string, options: IllustrateOptions): Promise<Illustrated> {
  const matches = [...html.matchAll(PLACEHOLDER)];
  const first = matches[0];
  if (first === undefined) {
    return { html, outcome: null };
  }
  const prompt = decodeEntities(first[3] ?? first[4] ?? '').trim().slice(0, PROMPT_MAX_CHARS);
  let replacement = '';
  let outcome: Illustrated['outcome'];
  if (options.illustrator === null) {
    outcome = { skipped: '这台 Plasticine 没有能出图的模型' };
  } else if (prompt === '') {
    outcome = { skipped: '插图的画面描述是空的' };
  } else {
    const drawn = await options.illustrator.draw(prompt, options.signal);
    if ('error' in drawn) {
      outcome = { skipped: drawn.error };
    } else {
      const asset = options.save(drawn.data, drawn.mime);
      replacement = figureWith(first, `${ASSET_PATH}${asset}`, prompt);
      outcome = { asset };
    }
  }
  let index = 0;
  const next = html.replace(PLACEHOLDER, () => {
    index += 1;
    return index === 1 ? replacement : '';
  });
  return { html: next, outcome };
}
