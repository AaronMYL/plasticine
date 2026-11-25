import { Value } from 'typebox/value';
import { readerBlocks } from '../../../agent/shared/web-reader.ts';
import {
  WEB_CIRCLE_TEXT_MAX_CHARS,
  WebCircleResultSchema,
  WebPageImageSchema,
  type WebCircleResult,
  type WebPageSnapshot,
} from '../api/shared.ts';
import type { Quote } from '../api/types.ts';

const QUOTE_LABEL_CHARS = 24;

export function imageFile(result: unknown, name: string): File {
  if (!Value.Check(WebPageImageSchema, result)) {
    throw new Error('原生回的截图格式不对');
  }
  const binary = atob(result.base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const extension = result.type === 'image/png' ? 'png' : 'jpg';
  return new File([bytes], `${name}.${extension}`, { type: result.type });
}

export function thumbnailUrl(result: unknown): string | null {
  if (!Value.Check(WebPageImageSchema, result)) {
    if (result !== null) {
      console.warn('原生回的缩略图格式不对，不放缩略图', result);
    }
    return null;
  }
  return `data:${result.type};base64,${result.base64}`;
}

export function circleResult(result: unknown): WebCircleResult | null {
  if (result === null) {
    return null;
  }
  if (!Value.Check(WebCircleResultSchema, result)) {
    throw new Error('原生回的圈一块格式不对');
  }
  return result;
}

function excerpt(text: string, chars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const all = Array.from(flat);
  return all.length > chars ? `${all.slice(0, chars).join('')}……` : flat;
}

export function circleQuote(result: WebCircleResult, at: Date): Quote {
  const text = Array.from(result.text.trim()).slice(0, WEB_CIRCLE_TEXT_MAX_CHARS).join('');
  const title = result.title.trim() === '' ? result.url : result.title.trim();
  const label = text === '' ? `圈自「${excerpt(title, QUOTE_LABEL_CHARS)}」` : excerpt(text, QUOTE_LABEL_CHARS);
  return { id: `quote_circle_${result.url}_${at.getTime()}`, kind: 'object', sourceId: result.url, label,
    text: `圈自「${title}」\n${result.url}\n\n${text === '' ? '〔圈的这一块里没有文字〕' : text}` };
}

function sourceLine(title: string, url: string, at: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const label = title.replace(/[[\]]/g, '');
  return `来源：[${label === '' ? url : label}](${url}) · ${day}`;
}

export function clipMarkdown(snapshot: WebPageSnapshot, at: Date): string {
  const note = snapshot.truncated ? `\n\n〔原文共 ${snapshot.totalChars.toLocaleString('zh-CN')} 字，只剪了前面一部分〕` : '';
  const body = readerBlocks(snapshot.text, snapshot.title).map((block) => (block.kind === 'heading' ? `## ${block.text}`
    : block.text)).join('\n\n');
  return `${noteHeader(snapshot, at)}\n${body}${note}\n`;
}

export function noteHeader(page: { title: string; url: string }, at: Date): string {
  const title = page.title.trim() === '' ? page.url : page.title.trim();
  return `# ${title}\n\n${sourceLine(page.title.trim(), page.url, at)}\n`;
}

export function screenshotMarkdown(page: { title: string; url: string }, imageUrl: string, at: Date): string {
  return `${noteHeader(page, at)}\n![截图](${imageUrl})\n`;
}

export { readerBlocks, type ReaderBlock } from '../../../agent/shared/web-reader.ts';
