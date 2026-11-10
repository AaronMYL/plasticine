import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useApiOrNull } from '../../api/context.tsx';
import type { LinkPreview } from '../../api/shared.ts';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { Icon } from '../../shell/icons.tsx';
import { inAppHash } from '../../shell/internal-page.ts';
import { SiteIcon } from '../../shell/site-icon.tsx';
import './message-links.css';

type Part = { kind: 'text'; text: string } | { kind: 'link'; href: string; label: string };

function linkLine(line: string): Extract<Part, { kind: 'link' }> | null {
  const markdown = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/[^\s)]+)\)$/.exec(line);
  const raw = markdown?.[2] ?? line.replace(/^<(https?:\/\/[^>]+)>$/, '$1');
  const href = inAppHash(raw) ?? raw;
  if (!/^#\/\S+$/.test(href)) {
    if (!/^https?:\/\/\S+$/.test(href) || !URL.canParse(href)) return null;
    const url = new URL(href);
    if (url.username !== '' || url.password !== '') return null;
  }
  return { kind: 'link', href, label: markdown?.[1] ?? '' };
}

/** 独立成行才展开；代码围栏和句子里的网址仍按原文显示。 */
export function splitMessageLinks(text: string): Part[] {
  const parts: Part[] = [];
  const lines: string[] = [];
  let fence = '';
  const flush = (): void => {
    const text = lines.join('\n');
    if (text.trim() !== '') parts.push({ kind: 'text', text });
    lines.length = 0;
  };
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      fence = fence === '' ? marker[0]! : marker[0] === fence ? '' : fence;
      lines.push(line);
      continue;
    }
    const link = fence === '' ? linkLine(line.trim()) : null;
    if (link === null) lines.push(line);
    else { flush(); parts.push(link); }
  }
  flush();
  return parts;
}

function LinkCard({ href, label }: { href: string; label: string }): ReactNode {
  const api = useApiOrNull();
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setPreview(null);
    setFailed(false);
    setImageFailed(false);
    if (api !== null) void api.links.preview(href, abort.signal).then((value) => {
      if (!abort.signal.aborted) setPreview(value);
    }, () => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [api, href]);
  const host = new URL(href).hostname;
  // 服务端封面必须走本站代理；即使回答里意外给了原站地址也不让浏览器直连。
  const cover = preview?.image?.startsWith('/v2/mail-image?') === true ? preview.image : null;
  return <a className="message-link-card" href={href} target="_blank" rel="noreferrer" data-preview-failed={failed}>
    <span className="message-link-copy">
      <span className="message-link-site text-meta"><SiteIcon url={href} title={host} />{preview?.site ?? host}</span>
      <span className="message-link-title">{preview?.title || label || href}</span>
      {preview?.description ? <span className="message-link-description">{preview.description}</span> : null}
    </span>
    {cover === null || imageFailed ? null : <img className="message-link-cover" src={cover} alt=""
      loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
  </a>;
}

function ObjectCard({ href, label }: { href: string; label: string }): ReactNode {
  const kind = href.split('/')[1] ?? '';
  const names: Readonly<Record<string, string>> = { notes: '笔记', books: '图书', tasks: '任务', library: '资料库',
    memory: '记忆', projects: '项目', plasticine: '对话', messages: '消息' };
  const name = names[kind] ?? '查看内容';
  return <a className="object-reference message-object-card" href={href}>
    <Icon name={kind === 'notes' ? 'notes' : 'file'} size={20} />
    <span><span className="text-meta">{name}</span><span>{label || name}</span></span>
    <Icon name="chevron-right" size={16} />
  </a>;
}

export function MessageContent({ text, markdown = true }: { text: string; markdown?: boolean }): ReactNode {
  const parts = splitMessageLinks(text);
  if (!parts.some((part) => part.kind === 'link')) {
    return markdown ? <Markdown text={text} /> : <div className="msg-text">{text}</div>;
  }
  const render = (part: Part): ReactNode => {
    if (part.kind === 'text') return markdown ? <Markdown text={part.text} />
      : <div className="msg-text message-plain">{part.text}</div>;
    return part.href.startsWith('#/') ? <ObjectCard href={part.href} label={part.label} />
      : <LinkCard href={part.href} label={part.label} />;
  };
  return <div className="message-content">
    {parts.map((part, index) => <Fragment key={index}>{render(part)}</Fragment>)}
  </div>;
}
