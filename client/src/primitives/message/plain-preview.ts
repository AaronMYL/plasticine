// 一行预览（消息列表、首页、通知）：按和正文同一个解析器（中日韩友好的强调规则）读出纯文字，Markdown 记号不出现。
// 用解析而不是正则删星号：`2*3=6` 这种不是记号的星号留着。

import type { Token, Tokens } from 'marked';
import { cjkMarked } from './cjk-marked.ts';

function inline(tokens: readonly Token[]): string {
  return tokens.map((token) => {
    if (token.type === 'image') return (token as Tokens.Image).text;
    if (token.type === 'br') return ' ';
    if ('tokens' in token && Array.isArray(token.tokens)) return inline(token.tokens);
    if (token.type === 'codespan' || token.type === 'text' || token.type === 'escape') return String(token.text);
    if (token.type === 'html') return '';
    return 'text' in token ? String(token.text) : '';
  }).join('');
}

function blocks(tokens: readonly Token[]): string[] {
  return tokens.flatMap((token): string[] => {
    switch (token.type) {
      case 'space':
      case 'hr':
      case 'html':
        return [];
      case 'code':
        return [(token as Tokens.Code).text];
      case 'list':
        return (token as Tokens.List).items.flatMap((item) => blocks(item.tokens));
      case 'blockquote':
        return blocks((token as Tokens.Blockquote).tokens);
      case 'table': {
        const table = token as Tokens.Table;
        return [table.header, ...table.rows].map((row) => row.map((cell) => inline(cell.tokens)).join(' '));
      }
      default:
        return 'tokens' in token && Array.isArray(token.tokens) ? [inline(token.tokens)]
          : 'text' in token ? [String(token.text)] : [];
    }
  });
}

/** 去掉 Markdown 记号后的一行文字（换行并成空格）。 */
export function plainPreview(markdown: string): string {
  if (markdown.trim() === '') return '';
  return blocks(cjkMarked.lexer(markdown)).join(' ').replace(/\s+/g, ' ').trim();
}
