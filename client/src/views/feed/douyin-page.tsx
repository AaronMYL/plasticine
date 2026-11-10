import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { VideoWorkView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { openExternal } from '../../shell/open-external.ts';
import { pushHash } from '../../shell/nav-history.ts';
import { routeHash } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { useMention } from '../conversation/mention-button.tsx';
import { SpaceFrame } from '../spaces/space-frame.tsx';
import { spaceRoute } from '../spaces/space-links.ts';
import { letterDate } from '../spaces/space-time.ts';
import { useLinkedSpace } from '../spaces/use-linked-space.ts';
import { useSpaceQuote } from '../spaces/space-quote.ts';
import '../spaces/space-frame.css';
import './douyin-page.css';

function meta(work: VideoWorkView, timeZone: string): string {
  const date = work.collectedAt === null ? null : `收藏于 ${new Intl.DateTimeFormat('zh-CN',
    { timeZone, month: 'numeric', day: 'numeric' }).format(new Date(work.collectedAt))}`;
  return [work.author, date].filter(Boolean).join(' · ');
}

function Detail({ work, phone, back }: { work: VideoWorkView; phone: boolean; back: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const mention = useMention();
  const { value: space, error, reload } = useLinkedSpace(work.spaceId ?? null);
  const quote = useSpaceQuote(space);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const process = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await api.feed.douyinProcess({ requestId: createRequestId(), ids: [work.id] });
      await live.douyin.load(false);
    } catch (cause) { setProblem(errorText(cause)); }
    finally { setBusy(false); }
  };
  const running = ['queued', 'running', 'waiting_mac'].includes(work.run);
  return <section className="dy-detail" aria-label="收藏详情">
    <header className="dy-detail-head">
      {phone ? <IconButton icon="back" label="返回收藏列表" onClick={back} /> : null}
      <span className="dy-version">{space === null ? '' : `空间 · 第 ${space.version} 版`}</span>
      <button type="button" className="secondary-button button-small"
        onClick={() => openExternal(work.url, work.title)}>原视频</button>
      {space === null ? null : <>
        <button type="button" className="secondary-button button-small" onClick={() => mention({ type: 'space',
          id: space.id, version: space.version, label: space.title, text: `讨论《${space.title}》` })}>讨论</button>
        <IconButton icon="external" label="在资料库打开" onClick={() => pushHash(routeHash(spaceRoute(space.id)))} />
      </>}
    </header>
    {error !== null ? <p className="block-empty is-error" role="alert">{error}{' '}
      <button type="button" className="text-button" onClick={reload}>重新读取</button></p>
      : space?.html != null ? <SpaceFrame className="space-frame" label={space.title} mode="page" onQuote={quote}
        space={{ html: space.html, genre: space.genre ?? 'report', title: space.title,
          dateLabel: letterDate(space.createdAt) }} />
        : <div className="dy-unprocessed"><h2>{work.title}</h2>
          {work.stage === 'summarized' ? <p role="status">正在整理报告…</p>
            : running ? <p role="status">{work.run === 'waiting_mac' ? '等电脑上线' : '正在处理…'}</p>
              : <button type="button" className="primary-button" disabled={busy}
                onClick={() => void process()}>{work.run === 'failed' ? '重新处理' : '处理作品'}</button>}
          {problem ?? work.error ? <p className="is-error" role="alert">{problem ?? work.error}</p> : null}
        </div>}
  </section>;
}

export function DouyinPage({ phone, onSelect }: { phone: boolean; onSelect: () => void }): ReactNode {
  const { douyin: store } = useLive();
  const state = useStore(store.state);
  const timeZone = useTimeZone();
  const [selected, setSelected] = useState<string | null>(null);
  const current = state.works.find((work) => work.id === selected) ?? null;
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  useEffect(() => {
    if (!phone && current === null && state.works[0] !== undefined) setSelected(state.works[0].id);
  }, [phone, current, state.works]);
  return <div className="dy-page" data-phone={phone} data-detail={phone && current !== null || undefined}>
    <section className="dy-index" aria-label="抖音收藏列表">
      <header className="dy-index-head"><span>按收藏时间</span>
        <IconButton icon="check" label="选择收藏" onClick={onSelect} />
        <button type="button" className="secondary-button button-small" disabled={state.busy === 'sync'
          || state.data?.sync.state === 'waiting_mac' || state.data?.sync.state === 'running'}
          onClick={() => void store.sync()}>同步</button></header>
      {state.error ?? state.data?.sync.error ? <p className="block-empty is-error" role="alert">
        {state.error ?? state.data?.sync.error}</p> : null}
      <div className="dy-index-scroll"><ul className="dy-works">
        {state.works.map((work) => <li key={work.id}><button type="button" className="dy-work"
          aria-current={work.id === selected ? 'true' : undefined} onClick={() => setSelected(work.id)}>
          <span><strong>{work.title}</strong><span className="dy-work-meta">{meta(work, timeZone)}</span></span>
          <span className="dy-work-state" role="img" aria-label={work.stage === 'summarized' ? '已总结' : '待处理'}>
            {work.stage === 'summarized' ? '✓' : '○'}</span>
        </button></li>)}
      </ul>{state.data?.nextOffset != null ? <button type="button" className="text-button dy-more"
        disabled={state.busy === 'more'} onClick={() => void store.more()}>更多收藏</button> : null}
      {state.works.length === 0 ? <p className="block-empty">{state.status === 'loading' ? '正在读收藏…' : '还没有同步收藏'}</p>
        : null}</div>
    </section>
    {current === null ? null : <Detail key={current.id} work={current} phone={phone} back={() => setSelected(null)} />}
  </div>;
}
