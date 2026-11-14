// 抖音收藏的勾选清单（《优化清单》第 9 条，设计稿 Feed-Douyin，放在信息流的来源管理里）：上次同步 + 同步；收藏夹、
// 搜标题和作者；每条一行：勾选、标题、作者 · 收藏日期、四格进度（已同步 → 已预览 → 已转写 → 已总结）；底部「已选 n 条」
// +「处理选中的」。不全量处理：他勾哪几条才处理哪几条；视频直接下载转写（11-09 他定，ⓘ 里说）。电脑不在线时取地址的活
// 排着，这一行写「等电脑上线」（Mac、Windows 的桌面客户端都能取）。

import { useEffect, useMemo, type ReactNode } from 'react';
import { VIDEO_STAGE_LABELS, VIDEO_STAGES, type VideoWorkView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { useStore } from '../../state/use-store.ts';
import './douyin-sheet.css';

const RUN_TEXT: Readonly<Record<VideoWorkView['run'], string | null>> = {
  idle: null,
  queued: '排着',
  waiting_mac: '等电脑上线',
  running: '在处理',
  failed: '没做成',
  waiting_transcriber: '等转写装好',
};

function dayText(iso: string | null, timeZone: string): string | null {
  if (iso === null) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(iso));
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('month')}月${part('day')}日`;
}

/** 四格进度：走到第几步就涂到第几格。 */
function Steps({ work }: { work: VideoWorkView }): ReactNode {
  const reached = VIDEO_STAGES.indexOf(work.stage) + 1;
  return (
    <span className="douyin-steps" role="img" aria-label={VIDEO_STAGE_LABELS[work.stage]}
      data-run={work.run}>
      {VIDEO_STAGES.map((stage, index) => <i key={stage} data-on={index < reached || undefined} />)}
    </span>
  );
}

function Row({ work, checked, onToggle }: { work: VideoWorkView; checked: boolean; onToggle: () => void }):
  ReactNode {
  const timeZone = useTimeZone();
  const run = RUN_TEXT[work.run];
  const collected = dayText(work.collectedAt, timeZone);
  const meta = [work.author, collected === null ? null : `收藏于 ${collected}`, run]
    .filter((part) => part !== null).join(' · ');
  return (
    <li className="douyin-row" data-run={work.run}>
      <label className="douyin-row-main">
        <input type="checkbox" className="douyin-check" checked={checked} onChange={onToggle}
          aria-label={`选中 ${work.title}`} />
        <span className="douyin-row-text">
          <span className="douyin-row-title">{work.title}</span>
          <span className="douyin-row-meta">{meta}</span>
        </span>
      </label>
      {work.run === 'failed' && work.error !== null ? (
        <InfoTip className="douyin-row-why" label="没做成的原因" text={work.error} side="left" />
      ) : null}
      <Steps work={work} />
    </li>
  );
}

function Count({ n }: { n: number }): ReactNode {
  return <span className="douyin-mono">{n.toLocaleString('en-US')}</span>;
}

export function DouyinSheet({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const phone = usePhone();
  const store = live.douyin;
  const state = useStore(store.state);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    store.open();
    return () => store.close();
  }, [open, store]);
  const { data, works, selected, busy } = state;
  const sync = data?.sync ?? null;
  const left = data === null ? 0 : data.total - works.length;
  const waitingMac = data !== null && !data.macOnline
    && (sync?.state === 'waiting_mac' || works.some((work) => work.run === 'waiting_mac'));
  const syncLabel = sync?.state === 'waiting_mac' ? '等电脑上线' : sync?.state === 'running' ? '正在同步'
    : sync?.lastAt == null ? '还没同步过' : `上次同步 ${dayText(sync.lastAt, timeZone) ?? ''}`;
  const folders = useMemo(() => data?.folders ?? [], [data]);
  return (
    <Sheet open={open} variant={phone ? 'drawer' : 'panel'} title="抖音收藏" onClose={onClose}
      className="douyin-sheet" lead={<HueTile hue="rose" icon="play" size={28} />}
      actions={(
        <>
          <span className="douyin-sync-meta">{syncLabel}</span>
          <button type="button" className="secondary-button button-small douyin-sync" disabled={busy === 'sync'
            || sync?.state === 'waiting_mac' || sync?.state === 'running'} onClick={() => void store.sync()}>
            <Icon name="refresh" size={13} />同步
          </button>
        </>
      )}>
      <div className="douyin">
        <div className="douyin-filters">
          <select className="field-input douyin-folder" aria-label="收藏夹" value={state.folder ?? ''}
            onChange={(event) => store.setFolder(event.target.value === '' ? null : event.target.value)}>
            <option value="">全部收藏夹</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <label className="douyin-search">
            <Icon name="search" size={14} />
            <input type="search" className="douyin-search-input" placeholder="搜标题、作者" aria-label="搜标题、作者"
              value={state.query} onChange={(event) => store.setQuery(event.target.value)} />
          </label>
        </div>
        {waitingMac ? <p className="douyin-note" role="status">电脑不在线：上线后自动去取。</p> : null}
        {sync?.state === 'failed' && sync.error !== null ? (
          <p className="douyin-note is-error" role="alert">{sync.error}</p>
        ) : null}
        {state.error === null ? null : <p className="douyin-note is-error" role="alert">{state.error}</p>}
        <div className="douyin-scroll">
          {state.status === 'loading' ? <p className="douyin-note">正在读收藏…</p> : null}
          {state.status === 'ready' && works.length === 0 && state.error === null ? (
            <p className="douyin-note">
              {state.query === '' && state.folder === null ? '还没同步过收藏。点「同步」从电脑上取标题。' : '没有对得上的收藏。'}
            </p>
          ) : null}
          <ul className="douyin-list" aria-label="收藏">
            {works.map((work) => (
              <Row key={work.id} work={work} checked={selected.has(work.id)} onToggle={() => store.toggle(work.id)} />
            ))}
          </ul>
          {left > 0 ? (
            <button type="button" className="text-button douyin-more" disabled={busy === 'more'}
              onClick={() => void store.more()}>
              {busy === 'more' ? '正在读…' : <>还有 <Count n={left} /> 条</>}
            </button>
          ) : null}
        </div>
        <footer className="douyin-foot">
          <span className="douyin-picked" role="status">{state.notice ?? <>已选 <Count n={selected.size} /> 条</>}</span>
          <span className="douyin-how">
            <InfoTip label="怎么处理" side="top"
              text="视频在你的服务器上下载、转写，再写出要点；图文读图里的文字。处理过的不会重复处理。" />
          </span>
          <button type="button" className="primary-button button-small" disabled={selected.size === 0
            || busy === 'process'} onClick={() => void store.process()}>处理选中的</button>
        </footer>
      </div>
    </Sheet>
  );
}
