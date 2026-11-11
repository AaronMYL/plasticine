// 手机上阅读页头下面的分段（11-11 第 11 批）：手机没有第二栏，用它在信息流和图书馆之间切。电脑不画。

import type { ReactNode } from 'react';
import { useRoute } from '../../shell/use-route.ts';
import { usePhone } from '../../shell/use-viewport-width.ts';
import './reading-tabs.css';

export function ReadingTabs({ current }: { current: 'feed' | 'books' }): ReactNode {
  const phone = usePhone();
  const { navigate } = useRoute();
  if (!phone) return null;
  return (
    <div className="segmented reading-tabs" role="group" aria-label="阅读">
      <button type="button" className="segmented-item" aria-pressed={current === 'feed'}
        onClick={() => navigate({ view: 'feed', noteId: null })}>信息流</button>
      <button type="button" className="segmented-item" aria-pressed={current === 'books'}
        onClick={() => navigate({ view: 'books', noteId: null, bookId: null })}>图书馆</button>
    </div>
  );
}
