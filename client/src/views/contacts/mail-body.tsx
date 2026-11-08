// 邮件正文（用户 2026-11-04 定：邮件按原样显示——正确解码，保留格式、排版、图片；整宽阅读区，不进聊天气泡）。
// HTML 信放进沙箱 iframe 的 srcdoc：
// - sandbox 不给 allow-scripts，信里的脚本一行都不跑；给 allow-same-origin 只为外面量得到正文高度、接住链接点击
//   （没有 allow-scripts，同源也跑不了信里的任何代码）；allow-popups(-to-escape-sandbox) 让链接在新窗口正常打开；
// - 文档里一条 CSP：图只认 data:（内嵌图）和本站（服务端代理的远程图），样式只认内联，别的一概不载；不带来源；
// - <base target="_blank">：链接开新窗口；有网页标签桥（Mac / iPhone App）时点击由 openExternal 开成标签；
// - 背景固定浅色（邮件都是照白底设计的，深色模式下也是一块白纸），高度随内容。
// 只有纯文字的信照原段落显示，网址可点。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { externalUrl, openExternal } from '../../shell/open-external.ts';

// iframe 量到高度之前先占这么高（一封短信的样子），量到了就换成正文的高度。
const FRAME_MIN_HEIGHT = 120;
// 纯文字里认网址：到空白、引号、尖括号或中文标点为止。
const LINK = /https?:\/\/[^\s<>"'，。；（）【】]+/g;
// 白纸上的字：邮件自己没写颜色和字体时用的。iframe 是另一份文档，拿不到页面的令牌，这里写死。
const READING_STYLE = 'html{color-scheme:light;background:#ffffff}'
  + 'body{margin:0;padding:16px;background:#ffffff;color:#222222;overflow-wrap:anywhere;'
  + 'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","MiSans","Microsoft YaHei",sans-serif}'
  + 'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}';

/** 沙箱 iframe 的 sandbox 属性（不含 allow-scripts）。 */
export const MAIL_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/** 一封信的整份 srcdoc：CSP、不带来源、链接开新窗口、白底，然后是清洗过的正文。 */
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
  // html 的盒子高度跟着内容走（不像 scrollHeight 至少是 iframe 自己那么高），变窄变宽都量得准。
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
  // 宽度变了（窗口、对话栏收起展开）正文会重排，再量一次。
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
    // 有网页标签桥时，信里的站外链接开成 Plasticine 的网页标签（壳在本页 document 上的拦截够不到 iframe 里）。
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

/** 只有纯文字的信：按空行分段，段里的换行照原样，网址可点。 */
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
