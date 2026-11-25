import type { ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { quoteCharacters } from '../../api/shared.ts';
import type { QuoteChip } from '../../api/types.ts';
import { showImages } from '../../primitives/image-viewer/index.tsx';
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
  const shot = page.snapshotId === null ? '' : api.attachments.contentUrl(page.snapshotId);
  return (
    <div className="page-card">
      {page.snapshotId === null ? null : (
        <button type="button" className="page-card-open" aria-label="看这一页当时的样子" onClick={() => showImages([{
          src: shot, alt: '这一页当时的样子', caption: page.title, original: page.url }])}>
          <img className="page-card-shot" src={shot} alt="这一页当时的样子" loading="lazy" decoding="async"
            draggable={false} />
        </button>
      )}
      <details className="page-card-detail">
        <summary aria-label={`${page.title}，${hostOf(page.url)}，${scope}；查看带给 Plasticine 的内容`}>
          <span className="row-card-mark"><SiteIcon url={page.url} title={page.title} size={20} /></span>
          <span className="row-card-text">
            <span className="row-card-title">{page.title}</span>
            <span className="row-card-meta">{hostOf(page.url)} · {scope}</span>
          </span>
          <Icon name="chevron-down" size={16} />
        </summary>
        <pre className="page-card-raw" tabIndex={0} aria-label="带给 Plasticine 的内容">{quote.text}</pre>
      </details>
    </div>
  );
}
