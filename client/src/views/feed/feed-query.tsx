// 搜索词用既有就地编辑；草稿和稳定请求都随页面切换保存，回执不明时只能原样核实。
import type { ReactNode } from 'react';
import type { FeedSourceView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { InlineEdit } from '../../primitives/inline-edit/index.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { feedQueryOpKey } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';

export function FeedQuery({ source }: { source: FeedSourceView }): ReactNode {
  const { feedActions: actions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = feedQueryOpKey(source.id);
  const op = useOp(key);
  const locked = op !== undefined && isOpenOp(op);
  const sent = locked && op.request.kind === 'feed_query' ? op.request.body.query : null;
  const editing = drafts.has(`${key}:editing`) || locked;
  const value = sent ?? drafts.get(key) ?? '';
  const cancel = (): void => {
    if (locked) { return; }
    inlineDrafts.clear(key);
    inlineDrafts.clear(`${key}:editing`);
    actions.dismiss(key);
  };
  return <>
    <span className="feed-source-query">搜：{source.searchTerms.join(' / ')}</span>
    {editing ? <InlineEdit label={`编辑「${source.label}」的搜索词`}
      fields={[{ name: 'query', label: '搜索词', value }]}
      status={op?.status === 'running' ? 'saving' : (op?.status === 'failed' ? 'failed' : 'draft')}
      submitDisabled={locked || value.trim() === '' || value.length > 500}
      onChange={(_name, next) => { if (!locked) { inlineDrafts.set(key, next); } }}
      onSubmit={() => void actions.setQuery(source)} onCancel={cancel}>
      <OpLines ops={op === undefined ? [] : [op]} onRetry={(id) => void actions.retry(id)}
        onDismiss={(id) => actions.dismiss(id)} />
    </InlineEdit> : <button type="button" className="text-button feed-query-edit" onClick={() => {
      inlineDrafts.set(key, source.query ?? source.label);
      inlineDrafts.set(`${key}:editing`, 'true');
    }}>编辑搜索词</button>}
  </>;
}
