import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { FeedNavSource } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { sourceSegment, type FeedSegment } from '../../state/feed-ui.ts';
import { feedNavChanged } from './feed-nav-data.ts';

export interface SourceActions {
  refresh(row: FeedNavSource): Promise<void>;
  refreshAll(rows: readonly FeedNavSource[], name?: string): Promise<{ text: string; failed: boolean }>;
  pause(row: FeedNavSource, paused: boolean): Promise<void>;
  remove(row: FeedNavSource, after?: FeedSegment): Promise<void>;
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
    async refreshAll(rows, name) {
      let added = 0;
      let asked = false;
      const problems: string[] = [];
      try {
        for (const row of rows.filter((entry) => entry.source.level !== 'off')) {
          try {
            if (row.kind === 'news') {
              await live.feedActions.refresh();
              added += live.feed.refresh.state.get().run?.added ?? 0;
            } else if (row.kind === 'douyin') {
              await api.feed.douyinSync({ requestId: createRequestId() });
            } else {
              const result = await api.feed.refreshSource(row.source.id, { requestId: createRequestId() });
              added += result.added;
              asked ||= row.kind === 'x' || row.kind === 'xhs';
              const problem = result.source.status?.error ?? null;
              if (problem !== null && row.kind !== 'x' && row.kind !== 'xhs') {
                problems.push(`${row.label} 没刷新成：${problem}`);
              }
            }
          } catch (cause) {
            problems.push(`${row.label} 没刷新成：${errorText(cause)}`);
          }
        }
        await live.feed.reload();
      } finally {
        feedNavChanged();
      }
      const prefix = name === undefined ? '' : `${name} `;
      if (added > 0) return { text: `${prefix}新增 ${String(added)} 篇`, failed: false };
      if (problems.length > 0) return { text: problems[0]!, failed: true };
      if (asked && rows.every((row) => row.kind === 'x' || row.kind === 'xhs')) {
        return { text: `已让电脑去读${name ?? ''}，读到就出现在这里`, failed: false };
      }
      return { text: '暂无新内容', failed: false };
    },
    async pause(row, paused) {
      await live.feedActions.setLevel(row.source, paused ? 'off' : 'normal');
      feedNavChanged();
    },
    async remove(row, after = 'all') {
      await api.feed.deleteSource(row.source.id, { requestId: createRequestId(), version: row.source.version });
      if (feedUi.segment() === sourceSegment(row.source.id)) {
        await live.feed.setSegment(after);
      } else {
        await live.feed.reload();
      }
      void live.feed.loadSources();
      feedNavChanged();
    },
  };
}
