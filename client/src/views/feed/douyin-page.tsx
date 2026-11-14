import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { DouyinPhaseFilter, VideoWorkView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
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
import { MoreState, useAutoMore } from './feed-pager.tsx';
import { TranscriberCard } from './transcriber-card.tsx';
import '../spaces/space-frame.css';
import './douyin-page.css';

function meta(work: VideoWorkView, timeZone: string): string {
  const date = work.collectedAt === null ? null : `收藏于 ${new Intl.DateTimeFormat('zh-CN',
    { timeZone, month: 'numeric', day: 'numeric' }).format(new Date(work.collectedAt))}`;
  return [work.author, date].filter(Boolean).join(' · ');
}

/**
 * 整理到哪了（11-11 第 11 批设计稿「P3 抖音」）：已整理 = 有总结；在整理 = 排着或在跑；等转写装好 = 点过处理、本地转写
 * 还没装（第13批）；其余没整理。
 */
export type DouyinPhase = 'todo' | 'running' | 'waiting' | 'done';
export const PHASE_LABELS: Readonly<Record<DouyinPhase, string>> = { todo: '没整理', running: '在整理',
  waiting: '等转写装好', done: '已整理' };
export function phaseOf(work: VideoWorkView): DouyinPhase {
  if (work.stage === 'summarized') return 'done';
  if (work.run === 'waiting_transcriber') return 'waiting';
  return ['queued', 'running', 'waiting_mac'].includes(work.run) ? 'running' : 'todo';
}
type Filter = 'all' | DouyinPhaseFilter;
const FILTER_LABELS: Readonly<Record<Filter, string>> = { all: '全部', todo: '没整理', done: '已整理' };

/** 时长 1:05 这样写；不知道就空。 */
export function durationText(seconds: number | null): string {
  if (seconds === null) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Detail({ work, phone, back }: { work: VideoWorkView; phone: boolean; back: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const mention = useMention();
  const { status: kit, error: installError } = useStore(live.transcriber.state);
  useEffect(() => live.transcriber.open(), [live.transcriber]);
  const { value: space, error, reload } = useLinkedSpace(work.spaceId ?? null);
  const quote = useSpaceQuote(space);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 视频要本地转写：没装时先问一句（asking），点「先不」就不下视频（later）。
  const [asking, setAsking] = useState(false);
  const [later, setLater] = useState(false);
  const process = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await api.feed.douyinProcess({ requestId: createRequestId(), ids: [work.id] });
      await live.douyin.load(false);
    } catch (cause) { setProblem(errorText(cause)); }
    finally { setBusy(false); }
  };
  const missing = kit !== null && kit.state !== 'ready';
  const start = (): void => {
    if (work.kind === 'video' && missing && kit.state !== 'installing') setAsking(true);
    else void process();
  };
  const waiting = work.run === 'waiting_transcriber';
  const showKit = kit !== null && missing && !later && (asking || waiting);
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
      <button type="button" className="text-button" onClick={reload}>再读一次</button></p>
      : space?.html != null ? <SpaceFrame className="space-frame" label={space.title} mode="page" onQuote={quote}
        space={{ html: space.html, genre: space.genre ?? 'report', title: space.title,
          dateLabel: letterDate(space.createdAt) }} />
        : showKit ? <div className="dy-kit"><TranscriberCard status={kit} error={installError}
          onLater={() => { setAsking(false); setLater(true); }}
          onInstall={() => void live.transcriber.install(waiting ? undefined : process)} /></div>
          : <div className="dy-unprocessed"><h2>{work.title}</h2>
            {work.stage === 'summarized' ? <p role="status">正在整理报告…</p>
              : running ? <p role="status">{work.run === 'waiting_mac' ? '等电脑上线' : '正在处理…'}</p>
                : waiting ? <p role="status">等本地转写装好{' '}
                  <button type="button" className="text-button" onClick={() => setLater(false)}>安装</button></p>
                  : <button type="button" className="primary-button" disabled={busy}
                    onClick={start}>{work.run === 'failed' ? '重新处理' : '处理作品'}</button>}
            {problem ?? work.error ? <p className="is-error" role="alert">{problem ?? work.error}</p> : null}
          </div>}
  </section>;
}

function WorkRow({ work, timeZone, current, picking, picked, onOpen, onPick }: { work: VideoWorkView;
  timeZone: string; current: boolean; picking: boolean; picked: boolean; onOpen: () => void;
  onPick: (on: boolean) => void }): ReactNode {
  const phase = phaseOf(work);
  const length = durationText(work.durationSeconds);
  const [broken, setBroken] = useState(false);
  const cover = work.coverUrl !== null && !broken ? work.coverUrl : null;
  const body = <>
    <span className="dy-work-thumb" aria-hidden="true">
      {cover === null ? <Icon name="play" size={16} />
        : <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      {length === '' ? null : <span className="dy-work-length">{length}</span>}</span>
    <span className="dy-work-text"><strong>{work.title}</strong>
      <span className="dy-work-meta">{meta(work, timeZone)}</span></span>
    {phase === 'todo' ? null : <span className="dy-work-phase" data-phase={phase}>{PHASE_LABELS[phase]}</span>}
  </>;
  if (picking) {
    return <label className="dy-work" data-picked={picked || undefined}>
      <input type="checkbox" checked={picked} disabled={phase !== 'todo'} aria-label={`选「${work.title}」`}
        onChange={(event) => onPick(event.target.checked)} />
      {body}
    </label>;
  }
  return <button type="button" className="dy-work" aria-current={current ? 'true' : undefined} onClick={onOpen}>
    {body}
  </button>;
}

export function DouyinPage({ phone, onSelect }: { phone: boolean; onSelect: () => void }): ReactNode {
  const api = useApi();
  const { douyin: store } = useLive();
  const state = useStore(store.state);
  const timeZone = useTimeZone();
  const [selected, setSelected] = useState<string | null>(null);
  const filter: Filter = state.phase ?? 'all';
  const sentinel = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = state.works.find((work) => work.id === selected) ?? null;
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  useEffect(() => {
    if (!phone && current === null && state.works[0] !== undefined) setSelected(state.works[0].id);
  }, [phone, current, state.works]);
  const counts = state.data?.counts ?? null;
  const shown = state.works;
  const end = state.data?.nextOffset == null;
  useAutoMore(sentinel, state.status === 'ready' && !end && state.busy !== 'more', () => void store.more());
  const stopPicking = (): void => {
    setPicking(false);
    setPicked(new Set());
  };
  const processPicked = async (): Promise<void> => {
    setRunning(true);
    setProblem(null);
    try {
      await api.feed.douyinProcess({ requestId: createRequestId(), ids: [...picked] });
      await store.load(false);
      stopPicking();
    } catch (cause) { setProblem(errorText(cause)); }
    finally { setRunning(false); }
  };
  return <div className="dy-page" data-phone={phone} data-detail={phone && current !== null || undefined}>
    <section className="dy-index" aria-label="抖音收藏列表">
      <header className="dy-index-head">
        <div className="segmented" role="group" aria-label="整理到哪了">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
            <button key={key} type="button" className="segmented-item" aria-pressed={filter === key}
              onClick={() => { if (key !== filter) void store.setPhase(key === 'all' ? null : key); }}>
              {FILTER_LABELS[key]}{counts === null ? null : <> <span className="dy-count">{counts[key]}</span></>}
            </button>
          ))}
        </div>
        <span className="dy-index-tools">
          <button type="button" className="text-button" aria-pressed={picking}
            onClick={() => picking ? stopPicking() : setPicking(true)}>{picking ? '取消' : '整理几条'}</button>
          <IconButton icon="check" label="选要同步的收藏" onClick={onSelect} />
          <button type="button" className="secondary-button button-small" disabled={state.busy === 'sync'
            || state.data?.sync.state === 'waiting_mac' || state.data?.sync.state === 'running'}
            onClick={() => void store.sync()}>同步</button>
        </span>
      </header>
      {state.error ?? state.data?.sync.error ? <p className="block-empty is-error" role="alert">
        {state.error ?? state.data?.sync.error}</p> : null}
      <div className="dy-index-scroll"><ul className="dy-works">
        {shown.map((work) => <li key={work.id}><WorkRow work={work} timeZone={timeZone}
          current={work.id === selected} picking={picking} picked={picked.has(work.id)}
          onOpen={() => setSelected(work.id)} onPick={(on) => setPicked((old) => {
            const next = new Set(old);
            if (on) next.add(work.id); else next.delete(work.id);
            return next;
          })} /></li>)}
      </ul>
      <div ref={sentinel} className="dy-sentinel" aria-hidden="true" />
      {state.works.length === 0 ? <p className="block-empty">{state.status === 'loading' ? '正在读收藏…'
        : filter === 'all' ? '还没有同步收藏' : `没有${FILTER_LABELS[filter]}的收藏`}</p>
        : <MoreState loading={state.busy === 'more'} end={false} error={null} onRetry={() => void store.more()} />}
      </div>
      {picking ? <footer className="dy-pick-bar">
        <span>{picked.size === 0 ? '勾选没整理的' : `选了 ${picked.size} 条`}</span>
        {problem === null ? null : <span className="is-error" role="alert">{problem}</span>}
        <button type="button" className="primary-button button-small" disabled={picked.size === 0 || running}
          onClick={() => void processPicked()}>{`整理这 ${picked.size} 条`}</button>
      </footer> : null}
    </section>
    {current === null ? null : <Detail key={current.id} work={current} phone={phone} back={() => setSelected(null)} />}
  </div>;
}
