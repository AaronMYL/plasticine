// 第二栏一行 ⋯ 里的动作（第 7 批第 10 条）：现在刷新 / 暂停或继续 / 删除。做完让第二栏重读（feedNavChanged）、信息流
// 重拉。刷新：订阅、Reddit、X 走 POST /v2/feed/sources/:id/refresh（X 只是记成到点，电脑下次来读）；按关注点的新闻
// 走原来的「寻找新内容」；抖音收藏就是「同步」（排给电脑）。暂停 / 继续沿用档位（off / normal）的那套操作记录。

import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import type { FeedNavSource } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { sourceSegment } from '../../state/feed-ui.ts';
import { feedNavChanged } from './feed-nav-data.ts';

export interface SourceActions {
  refresh(row: FeedNavSource): Promise<void>;
  pause(row: FeedNavSource, paused: boolean): Promise<void>;
  remove(row: FeedNavSource): Promise<void>;
}

export function useSourceActions(): SourceActions {
  const api = useApi();
  const live = useLive();
  const { feedUi } = useClientState();
  return {
    async refresh(row) {
      try {
        if (row.kind === 'news') {
          await live.feedActions.refresh();
        } else if (row.kind === 'douyin') {
          await api.feed.douyinSync({ requestId: createRequestId() });
        } else {
          await api.feed.refreshSource(row.source.id, { requestId: createRequestId() });
          await live.feed.reload();
        }
      } finally {
        feedNavChanged();
      }
    },
    async pause(row, paused) {
      await live.feedActions.setLevel(row.source, paused ? 'off' : 'normal');
      feedNavChanged();
    },
    async remove(row) {
      await api.feed.deleteSource(row.source.id, { requestId: createRequestId(), version: row.source.version });
      if (feedUi.segment() === sourceSegment(row.source.id)) {
        await live.feed.setSegment('all');
      } else {
        await live.feed.reload();
      }
      void live.feed.loadSources();
      feedNavChanged();
    },
  };
}
