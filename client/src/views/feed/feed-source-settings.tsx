// 一个来源的「设置…」（第 7 批第 10 条，第二栏一行的 ⋯ 里开）：订阅改名字、网址、档位；Reddit 改排序、档位；按关注点的
// 新闻是关注点编辑器；X、抖音收藏是登录状态 + 去登录（抖音多一个「选收藏…」）。上次取到的时间、没取到的原因写在顶上。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  REDDIT_SORT_LABELS,
  REDDIT_SORTS,
  redditFeedOf,
  type FeedNavSource,
  type RedditSort,
  type UpdateFeedSourceRequest,
} from '../../api/shared.ts';
import type { FeedSourceView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { when } from '../notes/note-time.ts';
import { LoginPanel } from './feed-add.tsx';
import { feedNavChanged } from './feed-nav-data.ts';
import { FeedSources } from './feed-sources.tsx';
import './feed-add.css';

type Level = Exclude<FeedSourceView['level'], 'off'>;
const LEVELS: ReadonlyArray<{ level: Level; label: string }> = [
  { level: 'more', label: '偏多' },
  { level: 'normal', label: '正常' },
  { level: 'less', label: '偏少' },
];

function Status({ row }: { row: FeedNavSource }): ReactNode {
  const timeZone = useTimeZone();
  const okAt = row.source.status?.okAt ?? null;
  return (
    <div className="feed-set-status">
      {row.problem === null ? null : <p className="feed-add-note is-error" role="alert">上次没取到：{row.problem}</p>}
      {okAt === null ? null : <p className="feed-add-note">上次取到：{when(okAt, new Date(), timeZone)}</p>}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }): ReactNode {
  return (
    <div className="feed-set-row">
      <span className="feed-set-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" className="segmented-item" aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

/** 订阅和 Reddit 的表单：只把改了的交上去。 */
function SourceForm({ row, onDone }: { row: FeedNavSource; onDone: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const source = row.source;
  const reddit = row.kind === 'reddit' && source.query !== null ? redditFeedOf(source.query) : null;
  const [label, setLabel] = useState(source.label);
  const [url, setUrl] = useState(source.query ?? '');
  const [sort, setSort] = useState<RedditSort | null>(reddit?.sort ?? null);
  const [level, setLevel] = useState<Level | null>(source.level === 'off' ? null : source.level);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch: Omit<UpdateFeedSourceRequest, 'requestId' | 'version'> = {
    ...(row.kind === 'rss' && label.trim() !== '' && label.trim() !== source.label ? { label: label.trim() } : {}),
    ...(row.kind === 'rss' && url.trim() !== '' && url.trim() !== source.query ? { url: url.trim() } : {}),
    ...(sort !== null && sort !== reddit?.sort ? { sort } : {}),
    ...(level !== null && level !== source.level ? { level } : {}),
  };
  const changed = Object.keys(patch).length > 0;
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.feed.updateSource(source.id, { requestId: createRequestId(), version: source.version, ...patch });
      feedNavChanged();
      void live.feed.loadSources();
      onDone();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="feed-add-form" aria-label={`「${row.label}」的设置`} onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
      {row.kind === 'rss' ? <>
        <label className="field-label">名字<input className="field-input" maxLength={200} value={label}
          onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="field-label">网址<input className="field-input" type="text" inputMode="url" maxLength={500}
          autoCapitalize="off" spellCheck={false} value={url}
          onChange={(event) => setUrl(event.target.value)} /></label>
      </> : null}
      {reddit === null ? null : (
        <Segmented label="排序" value={sort} onChange={setSort}
          options={REDDIT_SORTS.map((value) => ({ value, label: REDDIT_SORT_LABELS[value] }))} />
      )}
      <Segmented label="多少" value={level} onChange={setLevel}
        options={LEVELS.map((entry) => ({ value: entry.level, label: entry.label }))} />
      {error === null ? null : <p className="feed-add-note is-error" role="alert">{error}</p>}
      <footer className="feed-add-foot">
        <span className="feed-add-hint" />
        <button type="button" className="text-button" onClick={onDone}>取消</button>
        <button type="submit" className="primary-button" disabled={!changed || busy}>{busy ? '正在存…' : '保存'}</button>
      </footer>
    </form>
  );
}

export function FeedSourceSettings({ row, onClose, onDouyin }: { row: FeedNavSource; onClose: () => void;
  onDouyin: () => void }): ReactNode {
  return (
    <div className="feed-set">
      <Status row={row} />
      {row.kind === 'rss' || row.kind === 'reddit' ? <SourceForm row={row} onDone={onClose} /> : null}
      {row.kind === 'news' ? <FeedSources /> : null}
      {row.kind === 'x' ? <LoginPanel kind="x" /> : null}
      {row.kind === 'xhs' ? <LoginPanel kind="xhs" /> : null}
      {row.kind === 'douyin' ? <LoginPanel kind="douyin" onDouyin={onDouyin} /> : null}
    </div>
  );
}
