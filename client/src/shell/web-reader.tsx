// 阅读模式（第 2 批「浏览器」，⋯ 菜单）：不要原生新接口——用「问这一页」那份可见正文（snapshot），在 Plasticine 自己的
// 排版里重排一遍（笔记长文 16/28、一栏 680），原生网页先藏起来；再点「阅读模式」回到网页。只排读到的字，不改写、不摘要。

import { useEffect, useState, type ReactNode } from 'react';
import type { WebPageSnapshot } from '../api/shared.ts';
import { errorText } from '../api/errors.ts';
import { readPageSnapshot } from '../views/conversation/ask-this-page.tsx';
import { hostOf } from './web-address-field.tsx';
import { readerBlocks } from './web-tools.ts';

type Reading = { status: 'loading' } | { status: 'ready'; snapshot: WebPageSnapshot } | { status: 'failed';
  error: string };

export function WebReader({ tabId, url, onExit }: { tabId: string; url: string; onExit: () => void }): ReactNode {
  const [reading, setReading] = useState<Reading>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setReading({ status: 'loading' });
    readPageSnapshot(tabId).then((snapshot) => {
      if (!alive) {
        return;
      }
      setReading(snapshot === null ? { status: 'failed', error: '这里读不到网页正文' }
        : { status: 'ready', snapshot });
    }).catch((cause: unknown) => {
      console.warn('阅读模式没读到正文', cause);
      if (alive) {
        setReading({ status: 'failed', error: errorText(cause) });
      }
    });
    return () => {
      alive = false;
    };
  }, [tabId, url]);
  if (reading.status === 'loading') {
    return <div className="web-reader" aria-busy="true" aria-label="阅读模式" />;
  }
  if (reading.status === 'failed') {
    return (
      <div className="web-reader" aria-label="阅读模式">
        <p className="banner" role="alert">
          <span className="banner-text">没读到这一页的正文：{reading.error}。</span>
          <button type="button" className="chip-button" onClick={onExit}>回到网页</button>
        </p>
      </div>
    );
  }
  const { snapshot } = reading;
  return (
    <article className="web-reader" aria-label="阅读模式">
      <header className="web-reader-head">
        <h1>{snapshot.title === '' ? hostOf(snapshot.url) : snapshot.title}</h1>
        <p className="text-meta">{hostOf(snapshot.url)}</p>
      </header>
      {readerBlocks(snapshot.text, snapshot.title).map((block, index) => (block.kind === 'heading'
        ? <h2 key={index}>{block.text}</h2> : <p key={index}>{block.text}</p>))}
    </article>
  );
}
