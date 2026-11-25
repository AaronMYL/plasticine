import { FEED_BODY_MAX_BLOCKS, type FeedBlock } from '../../shared/state.ts';
import { tagAttributes, xmlText } from './feed-parse.ts';

const BODY_MAX_CHARS = 60_000;
const BLOCK_TAGS: Readonly<Record<string, FeedBlock['t']>> = {
  p: 'p', div: 'p', section: 'p', article: 'p', figure: 'p', figcaption: 'p', td: 'p', dd: 'p', dt: 'p',
  h1: 'h', h2: 'h', h3: 'h', h4: 'h', h5: 'h', h6: 'h',
  blockquote: 'quote', li: 'li', pre: 'code',
};

function httpsImage(raw: string | undefined, base: string): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' && url.href.length <= 3_000 ? url.href : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function articleBlocks(html: string, base: string): FeedBlock[] {
  const source = html.replace(/<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const blocks: FeedBlock[] = [];
  let kind: FeedBlock['t'] = 'p';
  let text = '';
  let chars = 0;
  const flush = (): void => {
    const clean = kind === 'code' ? text.replace(/^\n+|\s+$/g, '') : text.replace(/\s+/g, ' ').trim();
    if (clean !== '' && blocks.length < FEED_BODY_MAX_BLOCKS && chars < BODY_MAX_CHARS) {
      const kept = clean.slice(0, BODY_MAX_CHARS - chars);
      blocks.push({ t: kind, text: kept });
      chars += kept.length;
    }
    text = '';
  };
  const open: FeedBlock['t'][] = [];
  for (const token of source.matchAll(/<[^>]*>|[^<]+/g)) {
    const part = token[0];
    if (!part.startsWith('<')) {
      text += xmlText(part);
      continue;
    }
    const closing = part.startsWith('</');
    const name = /^<\/?\s*([a-z][\w-]*)/i.exec(part)?.[1]?.toLowerCase() ?? '';
    if (name === 'br') {
      text += '\n';
      continue;
    }
    if (name === 'img' && !closing) {
      const attrs = tagAttributes(part);
      const src = httpsImage(attrs['src'] ?? attrs['data-src'], base);
      if (src !== null && blocks.length < FEED_BODY_MAX_BLOCKS) {
        flush();
        blocks.push({ t: 'img', text: (attrs['alt'] ?? '').trim().slice(0, 300), src });
      }
      continue;
    }
    const block = BLOCK_TAGS[name];
    if (block === undefined) continue;
    flush();
    if (closing) {
      open.pop();
      kind = open.at(-1) ?? 'p';
    } else {
      const outer = open.at(-1);
      kind = outer !== undefined && outer !== 'p' && block === 'p' ? outer : block;
      open.push(kind);
    }
  }
  flush();
  return blocks;
}
