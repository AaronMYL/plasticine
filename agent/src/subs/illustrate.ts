import type { Illustrator, IllustrationMime } from '../kernel/index.ts';
import { decodeEntities, escapeHtmlAttribute } from '../../shared/space-html.ts';
import { LETTER_AI_MARK } from '../../shared/space-page/letter-css.ts';

const PLACEHOLDER = /<figure\b([^>]*)\bdata-illustrate\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>([\s\S]*?)<\/figure>/gi;
const PROMPT_MAX_CHARS = 1_000;
export const ASSET_PATH = '/v2/notes/assets/';

export interface IllustrateOptions {
  illustrator: Illustrator | null;
  save: (data: Buffer, mime: IllustrationMime) => string;
  signal: AbortSignal;
}

export interface Illustrated {
  html: string;
  outcome: { asset: string } | { skipped: string } | null;
}

function figureWith(match: RegExpExecArray, src: string, alt: string): string {
  const attrs = `${match[1] ?? ''}${match[5] ?? ''}`.replace(/\s+/g, ' ').trimEnd();
  const inner = match[6] ?? '';
  const image = `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}">`;
  return `<figure${attrs}>${image}${LETTER_AI_MARK}${inner}</figure>`;
}

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
