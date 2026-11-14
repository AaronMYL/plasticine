// 博客文章的全文（第13批，11-14 Aaron：博客「内容被截断」）：卡片上照旧是摘要，点「读全文」就地展开存下的全文——段落、小标题、
// 引用、列表、代码、图（图走服务端代理，不带来源）；读的时候一行「正在读全文」，没读到写原因、能再读一次；「收起」回到摘要。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FeedBlock } from '../../api/shared.ts';

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

/** 一段段画出来；连着的列表项合成一个列表。 */
export function ArticleBody({ blocks }: { blocks: readonly FeedBlock[] }): ReactNode {
  const out: ReactNode[] = [];
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
      out.push(<img key={index} src={block.src} alt={block.text} loading="lazy" referrerPolicy="no-referrer" />);
    } else {
      out.push(<p key={index}>{block.text}</p>);
    }
  }
  return <div className="feed-article">{out}</div>;
}
