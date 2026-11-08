import { Fragment, useMemo, type ReactNode } from 'react';
import { cjkMarked } from './cjk-marked.ts';
import './markdown.css';

// 和笔记同一个解析器（中日韩友好的强调规则）；React 渲染文本节点，不把模型文字作为 HTML 插入。
const parser = cjkMarked;
type Token = ReturnType<typeof parser.lexer>[number];
const OBJECT_PATHS: Record<string, string> = {
  任务: 'tasks', task: 'tasks', 笔记: 'notes', note: 'notes',
  判断: 'memory/judgments', judgment: 'memory/judgments',
  记忆: 'memory/entries', memory_entry: 'memory/entries',
  约定: 'memory/agreements', agreement: 'memory/agreements',
  证据: 'memory/sources', evidence: 'memory/sources', source: 'memory/sources',
  关切: 'concerns', concern: 'concerns',
};
const OBJECT_LABELS: Record<string, string> = {
  tasks: '任务', notes: '笔记', 'memory/judgments': '判断', 'memory/entries': '记忆',
  'memory/agreements': '约定', 'memory/sources': '证据', concerns: '项目',
};
const REFERENCE = /\[([^\s:\]]+):([^@\]\s]+)(?:@(\d+))?\]/g;

function references(text: string): ReactNode {
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(REFERENCE)) {
    const path = OBJECT_PATHS[match[1]!];
    if (path === undefined) { continue; }
    result.push(text.slice(cursor, match.index));
    result.push(<a key={match.index} className="object-reference"
      href={`#/${path}/${encodeURIComponent(match[2]!)}`}
      title={match[0]}>
      {OBJECT_LABELS[path]}{match[3] === undefined ? '' : ` · 第${match[3]}版`}
    </a>);
    cursor = match.index + match[0].length;
  }
  result.push(text.slice(cursor));
  return result;
}

function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => <Fragment key={index}>{renderToken(token)}</Fragment>);
}

function renderToken(token: Token): ReactNode {
  const children = (): ReactNode => 'tokens' in token && token.tokens !== undefined
    ? renderTokens(token.tokens as Token[]) : references('text' in token ? String(token.text) : '');
  switch (token.type) {
    case 'space': return null;
    case 'heading': {
      const Tag = `h${token.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return <Tag>{children()}</Tag>;
    }
    case 'paragraph': return <p>{children()}</p>;
    case 'text': return children();
    case 'strong': return <strong>{children()}</strong>;
    case 'em': return <em>{children()}</em>;
    case 'del': return <del>{children()}</del>;
    case 'codespan': return <code>{token.text}</code>;
    case 'code': return <pre><code data-language={token.lang}>{token.text}</code></pre>;
    case 'br': return <br />;
    case 'hr': return <hr />;
    case 'blockquote': return <blockquote>{children()}</blockquote>;
    case 'list': {
      const items = token.items.map((item: { task?: boolean; checked?: boolean; tokens: Token[] }, index: number) =>
        <li key={index}>
        {item.task ? <input type="checkbox" disabled checked={Boolean(item.checked)} /> : null}
        {renderTokens(item.tokens)}
      </li>);
      return token.ordered
        ? <ol start={typeof token.start === 'number' ? token.start : 1}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'link': {
      const href = String(token.href);
      return /^(https?:|mailto:|#\/|\/)/i.test(href)
        ? <a href={href} title={token.title ?? undefined} target={href.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer">{children()}</a> : children();
    }
    case 'image': return <a href={token.href} target="_blank" rel="noreferrer">{token.text || '查看图片'}</a>;
    case 'table': return <div className="markdown-table"><table>
      <thead><tr>{token.header.map((cell: { tokens: Token[] }, index: number) =>
        <th key={index}>{renderTokens(cell.tokens)}</th>)}</tr></thead>
      <tbody>{token.rows.map((row: { tokens: Token[] }[], index: number) => <tr key={index}>
        {row.map((cell, cellIndex) => <td key={cellIndex}>{renderTokens(cell.tokens)}</td>)}
      </tr>)}</tbody>
    </table></div>;
    default: return references(String(token.raw ?? ''));
  }
}

export function Markdown({ text }: { text: string }): ReactNode {
  const tokens = useMemo(() => parser.lexer(text), [text]);
  return <div className="markdown">{renderTokens(tokens)}</div>;
}
