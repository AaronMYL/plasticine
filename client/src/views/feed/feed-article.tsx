import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FeedBlock } from '../../api/shared.ts';
import { showImages } from '../../primitives/image-viewer/index.tsx';

type Article = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; blocks: FeedBlock[] }
  | { state: 'failed'; error: string };

export function useArticle(itemId: string): { article: Article; load: () => void; close: () => void } {
  const api = useApi();
  const [article, setArticle] = useState<Article>({ state: 'idle' });
  return {
    article,
    load: () => {
      setArticle({ state: 'loading' });
      api.feed.get(itemId).then((item) => setArticle({ state: 'ready', blocks: item.body ?? [] }),
        (cause: unknown) => setArticle({ state: 'failed', error: errorText(cause) }));
    },
    close: () => setArticle({ state: 'idle' }),
  };
}

export function ArticleBody({ blocks }: { blocks: readonly FeedBlock[] }): ReactNode {
  const out: ReactNode[] = [];
  const pictures = blocks.filter((block) => block.t === 'img' && block.src !== undefined)
    .map((block) => ({ src: block.src ?? '', alt: block.text, caption: block.text === '' ? undefined : block.text }));
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.t === 'li') {
      const items: FeedBlock[] = [];
      while (blocks[index]?.t === 'li') items.push(blocks[index++]!);
      index -= 1;
      out.push(<ul key={index}>{items.map((item, at) => <li key={at}>{item.text}</li>)}</ul>);
    } else if (block.t === 'h') {
      out.push(<h4 key={index}>{block.text}</h4>);
    } else if (block.t === 'quote') {
      out.push(<blockquote key={index}>{block.text}</blockquote>);
    } else if (block.t === 'code') {
      out.push(<pre key={index}><code>{block.text}</code></pre>);
    } else if (block.t === 'img') {
      const at = pictures.findIndex((picture) => picture.src === block.src);
      out.push(<button key={index} type="button" className="feed-article-image"
        aria-label={block.text === '' ? '查看图片' : `查看图片 ${block.text}`} onClick={() => showImages(pictures, at)}>
        <img src={block.src} alt={block.text} loading="lazy" referrerPolicy="no-referrer" />
      </button>);
    } else {
      out.push(<p key={index}>{block.text}</p>);
    }
  }
  return <div className="feed-article">{out}</div>;
}
