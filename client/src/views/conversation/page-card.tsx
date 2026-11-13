// 「问这一页」发出去的那句里的网页卡（11-13 Aaron 弹框选「快照卡」）：上面是这一页当时的截图（有才画），下面一行是
// 网站图标、标题、域名；点这一行摊开「带给 Plasticine 的内容」原文——原来这段给 AI 的结构数据直接露在引用片里，太乱。

import type { ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { quoteCharacters } from '../../api/shared.ts';
import type { QuoteChip } from '../../api/types.ts';
import { Icon } from '../../shell/icons.tsx';
import { SiteIcon } from '../../shell/site-icon.tsx';
import type { PageQuoteInfo } from './page-snapshot.ts';
import './page-card.css';

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch (cause) {
    if (cause instanceof TypeError) return url;
    throw cause;
  }
}

export function PageCard({ quote, page }: { quote: QuoteChip; page: PageQuoteInfo }): ReactNode {
  const api = useApi();
  const characters = quoteCharacters(quote.text).toLocaleString('zh-CN');
  const scope = page.reference ? '前面带过全文' : `${characters} 字`;
  return (
    <div className="page-card">
      {page.snapshotId === null ? null : (
        <img className="page-card-shot" src={api.attachments.contentUrl(page.snapshotId)} alt="这一页当时的样子"
          loading="lazy" decoding="async" draggable={false} />
      )}
      <details className="page-card-detail">
        <summary aria-label={`${page.title}，${hostOf(page.url)}，${scope}；查看带给 Plasticine 的内容`}>
          <SiteIcon url={page.url} title={page.title} size={20} />
          <span className="page-card-text">
            <span className="page-card-title" title={page.title}>{page.title}</span>
            <span className="page-card-meta">{hostOf(page.url)} · {scope}</span>
          </span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <pre className="page-card-raw" tabIndex={0} aria-label="带给 Plasticine 的内容">{quote.text}</pre>
      </details>
    </div>
  );
}
