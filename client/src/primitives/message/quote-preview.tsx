import type { MouseEvent, ReactNode } from 'react';
import type { QuoteChip } from '../../api/types.ts';
import { quoteCharacters } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { routeHash, type Route } from '../../shell/routes.ts';
import { useRoute } from '../../shell/use-route.ts';
import './quote-preview.css';

/** 书引用的标签「《浮生六记》 卷一　闺房记乐」在引用片上写短一点：「《浮生六记》卷一」。 */
function shortBookLabel(label: string): string {
  const match = /^(《[^》]*》)\s*(\S*)/.exec(label);
  return match === null ? label : `${match[1]}${match[2]?.split('　')[0] ?? ''}`;
}

function detailText(quote: QuoteChip, scope: string): string {
  if (quote.kind === 'message') return '引用对话中的原文。';
  if (quote.bookReference !== undefined) {
    return '引用书里的一段原文。下方是提供给对话的实际文字。';
  }
  const reference = quote.noteReference;
  return reference === undefined ? '这份引用只包含下方文字，未记录全文范围或笔记版本。'
    : `引用笔记版本 ${reference.version} 的${scope}。下方是提供给对话的实际文字。`;
}

/** 待发与历史都展开实际快照；不重新读笔记，避免把后来改过的正文冒充当时的引用。书引用另有「回到原文」。 */
export function QuotePreview({ quote, onRemove }: { quote: QuoteChip; onRemove?: () => void }): ReactNode {
  const { navigate } = useRoute();
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
  return (
    <div className="quote-preview">
      <details>
        <summary aria-label={`查看引用内容：${label}，${scope}，${characters} 字`}>
          <span className="quote-preview-label">{label}</span>
          <span className="quote-preview-scope">{scope} · {characters} 字</span>
          {source === null ? <span className="quote-preview-toggle">查看内容</span> : null}
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
