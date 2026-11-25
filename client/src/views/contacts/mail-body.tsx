import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { externalUrl, openExternal } from '../../shell/open-external.ts';

const FRAME_MIN_HEIGHT = 120;
const LINK = /https?:\/\/[^\s<>"'，。；（）【】]+/g;
const READING_STYLE = 'html{color-scheme:light;background:#ffffff}'
  + 'body{margin:0;padding:16px;background:#ffffff;color:#222222;overflow-wrap:anywhere;'
  + 'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","MiSans","Microsoft YaHei",sans-serif}'
  + 'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}';

export const MAIL_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export function mailDocument(html: string, origin: string): string {
  const policy = `default-src 'none'; img-src data: ${origin}; style-src 'unsafe-inline'; font-src data:`;
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${policy}">`
    + '<meta name="referrer" content="no-referrer"><base target="_blank">'
    + `<style>${READING_STYLE}</style></head><body>${html}</body></html>`;
}

function contentHeight(frame: HTMLIFrameElement): number | null {
  const root = frame.contentDocument?.documentElement;
  if (root === undefined || root === null) {
    return null;
  }
  return Math.ceil(Math.max(root.getBoundingClientRect().height, frame.contentDocument?.body?.scrollHeight ?? 0));
}

function HtmlBody({ html, subject }: { html: string; subject: string }): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(FRAME_MIN_HEIGHT);
  const fit = useCallback(() => {
    const element = frame.current;
    const measured = element === null ? null : contentHeight(element);
    if (measured !== null && measured > 0) {
      setHeight(measured);
    }
  }, []);
  useEffect(() => {
    const element = frame.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
  const loaded = (): void => {
    fit();
    frame.current?.contentDocument?.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const url = anchor === null ? null : externalUrl(anchor.getAttribute('href') ?? '');
      if (url !== null) {
        event.preventDefault();
        openExternal(url, (anchor?.textContent ?? '').trim() || url);
      }
    });
  };
  return (
    <iframe ref={frame} className="mail-frame" title={`邮件正文：${subject}`} sandbox={MAIL_SANDBOX}
      referrerPolicy="no-referrer" srcDoc={mailDocument(html, window.location.origin)} style={{ height }}
      onLoad={loaded} />
  );
}

function linked(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    nodes.push(text.slice(last, match.index));
    nodes.push(<a key={match.index} href={match[0]} target="_blank" rel="noopener noreferrer">{match[0]}</a>);
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return nodes;
}

export function TextBody({ text }: { text: string }): ReactNode {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <div className="mail-text">
      {paragraphs.map((paragraph, index) => <p key={index}>{linked(paragraph)}</p>)}
    </div>
  );
}

export interface MailBodyProps {
  subject: string;
  html: string | null;
  text: string;
}

export function MailBody({ subject, html, text }: MailBodyProps): ReactNode {
  return html === null ? <TextBody text={text} /> : <HtmlBody html={html} subject={subject} />;
}
