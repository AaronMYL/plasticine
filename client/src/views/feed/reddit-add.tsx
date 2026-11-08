// 加 Reddit 版块（第 7 批第 13 条，设计稿 Feed-Add）：输入框前面写着 r/，填版块名（粘网址、带 r/ 都认），停手一会儿就
// 让服务端代取最新三条预览（取不到就地写原因）；排序 热门 / 最新 / 本周最佳；「添加」。服务器直接取，不用登录；英文帖子
// 会翻成中文（ⓘ）。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  REDDIT_SORT_LABELS,
  REDDIT_SORTS,
  subredditOf,
  type RedditPreviewResponse,
  type RedditSort,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { feedNavChanged } from './feed-nav-data.ts';
import { RedditMark } from './feed-source-list.tsx';

/** 停手这么久再去预览，不每敲一个字就取一次（Reddit 会限流）。 */
const PREVIEW_DELAY_MS = 500;

type Preview = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: RedditPreviewResponse }
  | { status: 'failed'; error: string };

function usePreview(name: string | null, sort: RedditSort): Preview {
  const api = useApi();
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  useEffect(() => {
    if (name === null) {
      setPreview({ status: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setPreview({ status: 'loading' });
    const timer = window.setTimeout(() => {
      api.feed.previewReddit({ subreddit: name, sort }, controller.signal).then(
        (data) => setPreview({ status: 'ready', data }),
        (cause: unknown) => {
          if (!controller.signal.aborted) setPreview({ status: 'failed', error: errorText(cause) });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, name, sort]);
  return preview;
}

function problemOf(preview: Preview): string | null {
  if (preview.status === 'failed') {
    return preview.error;
  }
  return preview.status === 'ready' ? preview.data.error : null;
}

export function RedditAdd({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const [text, setText] = useState('');
  const [sort, setSort] = useState<RedditSort>('hot');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = subredditOf(text);
  const preview = usePreview(name, sort);
  const failed = problemOf(preview);
  const posts = preview.status === 'ready' ? preview.data.posts : [];
  const ok = name !== null && preview.status === 'ready' && posts.length > 0;
  const add = async (): Promise<void> => {
    if (name === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.feed.addReddit({ requestId: createRequestId(), subreddit: name, sort });
      feedNavChanged();
      void live.feed.loadSources();
      onAdded();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const now = new Date();
  return (
    <form className="feed-add-form" aria-label="加 Reddit 版块" onSubmit={(event) => {
      event.preventDefault();
      void add();
    }}>
      <label className="feed-add-field">
        <span className="feed-add-prefix" aria-hidden="true">r/</span>
        <input className="feed-add-input" type="text" autoCapitalize="off" spellCheck={false} maxLength={200}
          aria-label="版块名" placeholder="neuroscience" value={text} autoFocus
          onChange={(event) => setText(event.target.value)} />
        {ok ? <span className="feed-add-ok" role="img" aria-label="找到了这个版块" /> : null}
      </label>
      <div className="segmented feed-add-sort" role="group" aria-label="排序">
        {REDDIT_SORTS.map((value) => (
          <button key={value} type="button" className="segmented-item" aria-pressed={sort === value}
            onClick={() => setSort(value)}>{REDDIT_SORT_LABELS[value]}</button>
        ))}
      </div>
      <div className="feed-add-preview" aria-live="polite" aria-busy={preview.status === 'loading'}>
        {preview.status === 'loading' ? <p className="feed-add-note">正在看这个版块…</p> : null}
        {failed === null ? null : <p className="feed-add-note is-error" role="alert">{failed}</p>}
        {posts.length === 0 ? null : (
          <ul className="feed-add-posts" aria-label="最新几条">
            {posts.map((post) => (
              <li key={post.url} className="feed-add-post">
                <RedditMark />
                <span className="feed-add-post-text">
                  <span className="feed-add-post-title">{post.title}</span>
                  <span className="feed-add-post-meta">
                    {[post.author, relativeTime(post.publishedAt, now)].filter((part) => part !== null).join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error === null ? null : <p className="feed-add-note is-error" role="alert">{error}</p>}
      <footer className="feed-add-foot">
        <span className="feed-add-hint">
          英文帖子会翻成中文
          <InfoTip label="怎么取" text="服务器直接取这个版块的公开内容，不用登录；每 2 小时取一次。" side="top" />
        </span>
        <button type="button" className="text-button" onClick={onCancel}>取消</button>
        <button type="submit" className="primary-button" disabled={!ok || busy}>{busy ? '正在加…' : '添加'}</button>
      </footer>
    </form>
  );
}
