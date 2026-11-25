import { render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lineItemForSeq, useFocusMessage, type FocusTarget } from '../../src/shell/use-focus-message.ts';

function Harness({ target, seqs, onFocused }: { target: FocusTarget | null; seqs: [number, number][];
  onFocused: () => void }): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  useFocusMessage(scroller, target, onFocused);
  return <div ref={scroller}>{seqs.map(([from, to]) => <div key={from} data-seq-from={from} data-seq-to={to}
    data-testid={`item-${from}`} />)}</div>;
}

describe('locating a message', () => {
  it('finds item containing seq or nearest subsequent item when seq falls between items', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-seq-from="3" data-seq-to="5"></div><div data-seq-from="9" data-seq-to="9"></div>';
    expect(lineItemForSeq(root, 4)?.dataset['seqFrom']).toBe('3');
    expect(lineItemForSeq(root, 7)?.dataset['seqFrom']).toBe('9');
    expect(lineItemForSeq(root, 12)).toBeNull();
  });

  it('loads older messages if needed, scrolls and flashes target once', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const loadMore = vi.fn();
    const onFocused = vi.fn();
    const base = { key: 'line-main:4', ready: true, busy: false, loadMore,
      find: (root: HTMLElement) => lineItemForSeq(root, 4) };
    const view = render(<Harness target={{ ...base, canLoadMore: true }} seqs={[[10, 12]]} onFocused={onFocused} />);
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(onFocused).not.toHaveBeenCalled();
    view.rerender(<Harness target={{ ...base, busy: true, canLoadMore: false }} seqs={[[3, 5], [10, 12]]}
      onFocused={onFocused} />);
    expect(onFocused).not.toHaveBeenCalled();
    view.rerender(<Harness target={{ ...base, canLoadMore: false }} seqs={[[3, 5], [10, 12]]} onFocused={onFocused} />);
    expect(onFocused).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' });
    expect(view.getByTestId('item-3').classList.contains('is-focused')).toBe(true);
    view.rerender(<Harness target={{ ...base, canLoadMore: false }} seqs={[[3, 5], [10, 12]]} onFocused={onFocused} />);
    expect(onFocused).toHaveBeenCalledTimes(1);
  });

  it('does not scroll or flash when target message no longer exists', () => {
    const onFocused = vi.fn();
    render(<Harness target={{ key: 'c1:m9', ready: true, busy: false, canLoadMore: false, loadMore: vi.fn(),
      find: () => null }} seqs={[[1, 2]]} onFocused={onFocused} />);
    expect(onFocused).not.toHaveBeenCalled();
  });
});
