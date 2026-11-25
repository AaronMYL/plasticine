import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useApiOrNull } from '../../api/context.tsx';
import type { LinkPreview } from '../../api/shared.ts';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { HueTile, KIND_STYLE, type HueName } from '../../shell/hue.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
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
    else {
      flush();
      parts.push(link);
    }
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
  const cover = preview?.image?.startsWith('/v2/mail-image?') === true ? preview.image : null;
  return <a className="row-card message-link-card" href={href} target="_blank" rel="noreferrer"
    data-preview-failed={failed}>
    <span className="row-card-mark">
      {cover === null || imageFailed ? <SiteIcon url={href} title={host} size={20} />
        : <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
    </span>
    <span className="row-card-text">
      <span className="row-card-title">{preview?.title || label || href}</span>
      <span className="row-card-meta">{preview?.site ?? host}</span>
    </span>
    <span className="row-card-end"><Icon name="external" size={16} /></span>
  </a>;
}

const OBJECT_KINDS: Readonly<Record<string, { name: string; hue: HueName; icon: IconName }>> = {
  notes: { name: '笔记', ...KIND_STYLE.note }, books: { name: '图书', ...KIND_STYLE.book },
  tasks: { name: '任务', ...KIND_STYLE.task }, library: { name: '资料库', hue: 'ochre', icon: 'library' },
  memory: { name: '记忆', hue: 'plum', icon: 'memory' }, projects: { name: '项目', ...KIND_STYLE.project },
  plasticine: { name: '对话', hue: 'clay', icon: 'conversation' },
  messages: { name: '消息', hue: 'sky', icon: 'conversation' },
};

function ObjectCard({ href, label }: { href: string; label: string }): ReactNode {
  const kind = OBJECT_KINDS[href.split('/')[1] ?? ''] ?? { name: '查看内容', hue: 'ink', icon: 'file' };
  return <a className="object-reference row-card message-object-card" href={href}>
    <HueTile hue={kind.hue} icon={kind.icon} size={40} />
    <span className="row-card-text">
      <span className="row-card-title">{label || kind.name}</span>
      <span className="row-card-meta">{kind.name}</span>
    </span>
    <span className="row-card-end"><Icon name="chevron-right" size={16} /></span>
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
