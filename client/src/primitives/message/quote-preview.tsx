import type { MouseEvent, ReactNode } from 'react';
import type { QuoteChip } from '../../api/types.ts';
import { quoteCharacters } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useRoute } from '../../shell/use-route.ts';
import './quote-preview.css';

/** 书引用的标签「《浮生六记》 卷一　闺房记乐」在引用片上写短一点：「《浮生六记》卷一」。 */
function shortBookLabel(label: string): string {
  const match = /^(《[^》]*》)\s*(\S*)/.exec(label);
  return match === null ? label : `${match[1]}${match[2]?.split('　')[0] ?? ''}`;
}

function detailText(quote: QuoteChip, scope: string): string {
  const reference = quote.noteReference;
  return reference === undefined ? scope : `第 ${reference.version} 版 · ${scope}`;
}

/** 待发与历史都展开实际快照；不重新读笔记，避免把后来改过的正文冒充当时的引用。书引用另有「回到原文」。 */
export function QuotePreview({ quote, onRemove }: { quote: QuoteChip; onRemove?: () => void }): ReactNode {
  const { navigate } = useRoute();
  const space = quote.spaceReference;
  const reference = quote.noteReference;
  const book = quote.bookReference;
  const scope = quote.kind === 'message' ? '选文' : book !== undefined || reference?.scope === 'selection' ? '选段'
    : reference?.scope === 'full' ? '全文' : '摘要';
  const label = book === undefined ? quote.label : shortBookLabel(quote.label);
  const characters = quoteCharacters(quote.text).toLocaleString('zh-CN');
  const source: Route | null = book === undefined ? null : { view: 'books', noteId: null, bookId: book.bookId,
    bookPosition: { chapter: book.chapter, offset: book.start } };
  const openSource = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (source !== null) {
      event.preventDefault();
      navigate(source);
    }
  };
  if (space !== undefined) {
    const route: Route = { view: 'books', noteId: null, bookId: null, spaceId: space.spaceId,
      spacePosition: { version: space.version, paragraph: space.anchor.paragraph } };
    return <div className="quote-preview quote-preview-excerpt">
      <Icon name="quote" size={14} />
      <a className="quote-preview-body" href={routeHash(route)} onClick={(event) => {
        event.preventDefault();
        navigate(route);
      }}><span className="quote-preview-label">{quote.label}</span>
        <span className="quote-preview-text">{quote.text}</span></a>
      {onRemove === undefined ? null : <IconButton icon="close" label={`去掉引用：${quote.label}`}
        className="quote-preview-remove" onClick={onRemove} />}
    </div>;
  }
  return (
    <div className="quote-preview quote-preview-excerpt">
      <Icon name="quote" size={14} />
      <details>
        <summary aria-label={`查看引用内容：${label}，${scope}，${characters} 字`}>
          <span className="quote-preview-label">{label}</span>
          <span className="quote-preview-scope">{scope} · {characters} 字</span>
          {source === null ? <span className="quote-preview-toggle">查看内容</span> : null}
          <span className="quote-preview-text">{quote.text}</span>
        </summary>
        <div className="quote-preview-detail">
          <p>{detailText(quote, scope)}</p>
          <pre tabIndex={0} aria-label="实际引用内容">{quote.text === '' ? '（空白笔记）' : quote.text}</pre>
        </div>
      </details>
      {source === null ? null : (
        <a className="quote-preview-source" href={routeHash(source)} onClick={openSource}>回到原文</a>
      )}
      {onRemove === undefined ? null : <IconButton icon="close" label={`去掉引用：${label}`}
        className="quote-preview-remove" onClick={onRemove} />}
    </div>
  );
}
