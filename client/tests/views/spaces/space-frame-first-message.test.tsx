import { useLayoutEffect } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { SpaceFrame } from '../../../src/views/spaces/space-frame.tsx';

function FirstFrameLink() {
  useLayoutEffect(() => {
    const frame = document.querySelector('iframe')!;
    const data = { pz: 'space', type: 'link', kind: 'book', id: 'book-demo:1:7' };
    window.dispatchEvent(new MessageEvent('message', { source: window, data }));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }));
  }, []);
  return null;
}

it('space accepts source messages on first render only from its own iframe origin', () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  const jump = vi.fn();
  render(<ApiProvider api={fake.api}>
    <SpaceFrame label="示例图书大纲" mode="page" onBookJump={jump}
      space={{ title: '示例图书大纲', genre: 'report', dateLabel: '',
        html: '<p><a data-link="book:book-demo:1:7">回原文</a></p>' }} />
    <FirstFrameLink />
  </ApiProvider>);
  expect(jump).toHaveBeenCalledTimes(1);
  expect(jump).toHaveBeenCalledWith({ bookId: 'book-demo', chapter: 1, offset: 7 });
});
