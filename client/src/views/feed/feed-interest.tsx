import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { useOp } from '../pending/pending-ops.tsx';

const KEY = 'feed:interest:new';
/** alwaysOpen：在「加来源」里直接摊开表单（不先给「加关注点」那个按钮），也没有「先不」。 */
export function FeedInterest({ alwaysOpen = false }: { alwaysOpen?: boolean }): ReactNode {
  const live = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(KEY);
  const locked = op !== undefined && isOpenOp(op);
  const sent = locked && op.request.kind === 'feed_interest' ? op.request.body : null;
  const label = sent?.label ?? drafts.get(`${KEY}:label`) ?? '';
  const query = sent?.query ?? drafts.get(`${KEY}:query`) ?? '';
  const open = alwaysOpen || locked || drafts.get(`${KEY}:open`) === 'yes' || label !== '' || query !== '';
  if (!open) {
    return <button type="button" className="text-button" onClick={() => inlineDrafts.set(`${KEY}:open`, 'yes')}>
      加关注点
    </button>;
  }
  return <section className="feed-interest" aria-label="加关注点">
    <label className="field-label">关注点名字<input className="field-input" maxLength={200} value={label}
      readOnly={locked} onChange={(event) => inlineDrafts.set(`${KEY}:label`, event.target.value)} /></label>
    <label className="field-label">搜索词<input className="field-input" maxLength={500} value={query}
      readOnly={locked} onChange={(event) => inlineDrafts.set(`${KEY}:query`, event.target.value)} /></label>
    <p className="text-meta">同时在「个人」项目里建一条留意方向。</p>
    <button type="button" className="chip-button" disabled={locked || !label.trim() || !query.trim()}
      onClick={() => void live.feedActions.addInterest()}>添加关注点</button>{' '}
    {alwaysOpen ? null : <button type="button" className="text-button" disabled={locked} onClick={() => {
      for (const field of ['label', 'query', 'open']) { inlineDrafts.clear(`${KEY}:${field}`); }
    }}>先不</button>}
    <OpLines ops={op === undefined ? [] : [op]} onRetry={(key) => void live.feedActions.retry(key)}
      onDismiss={(key) => live.feedActions.dismiss(key)} />
  </section>;
}

export function FeedSite({ site, count, blocked }: { site: string; count: number; blocked: boolean }): ReactNode {
  const live = useLive();
  const op = useOp(`feed:site:${site}`);
  const locked = op !== undefined && isOpenOp(op);
  return <li>
    <span>{site} <span className="feed-mono">{count}</span></span>{' '}
    <button type="button" className="text-button" disabled={locked}
      onClick={() => void live.feedActions.blockSite(site, !blocked)}>{blocked ? '恢复' : '屏蔽'}</button>
    <OpLines ops={op === undefined ? [] : [op]} onRetry={(key) => void live.feedActions.retry(key)}
      onDismiss={(key) => live.feedActions.dismiss(key)} />
  </li>;
}
