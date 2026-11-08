// 加订阅（第 3 批 11-04：他只给网址，Plasticine 自己找订阅地址、用订阅源自己的名字）。地址草稿及重试标识留在会话存储；
// 失败时沿用原请求，服务器按标识去重。第 7 批起只在信息流「加来源」的「网址」里。

import { useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import { useApi } from '../../api/context.tsx';
import { ApiError, errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { AddSubscriptionRequestSchema, type AddSubscriptionRequest } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { feedNavChanged } from './feed-nav-data.ts';

const PREFIX = 'feed:subscription:';
function pending(raw: string | undefined): AddSubscriptionRequest | null {
  if (raw === undefined) { return null; }
  const value: unknown = JSON.parse(raw);
  if (!Value.Check(AddSubscriptionRequestSchema, value)) { throw new Error('订阅草稿格式不对，请保留草稿后重新读取。'); }
  return value;
}

/** 用户常直接粘 example.com：没写协议就当 https。 */
function normalized(raw: string): string {
  const trimmed = raw.trim();
  return trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function FeedSubscription({ onAdded }: { onAdded?: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const sent = pending(drafts.get(`${PREFIX}request`));
  const url = sent?.url ?? drafts.get(`${PREFIX}url`) ?? '';
  const target = normalized(url);
  const add = async () => {
    const input: AddSubscriptionRequest = sent ?? { requestId: createRequestId(), url: target };
    inlineDrafts.set(`${PREFIX}request`, JSON.stringify(input));
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const source = await api.feed.subscribe(input);
      setAdded(source.label);
      inlineDrafts.clear(`${PREFIX}url`);
      inlineDrafts.clear(`${PREFIX}request`);
      await live.feed.loadSources();
      feedNavChanged();
      onAdded?.();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status === 400) { inlineDrafts.clear(`${PREFIX}request`); }
    } finally { setBusy(false); }
  };
  return <form className="feed-subscribe" aria-label="加订阅" onSubmit={(event) => {
    event.preventDefault();
    void add();
  }}>
    {/* type=text：type=url 会让浏览器拦下没写协议的 example.com，这里自己补 https。 */}
    <input className="field-input" type="text" inputMode="url" autoCapitalize="off" spellCheck={false}
      maxLength={500} value={url}
      aria-label="网站或订阅地址" placeholder="网站或订阅地址" readOnly={busy || sent !== null}
      onChange={(event) => inlineDrafts.set(`${PREFIX}url`, event.target.value)} />
    <button type="submit" className="primary-button" disabled={busy || !target.startsWith('https://')}>
      {busy ? '正在找订阅…' : '添加'}</button>
    {error === null ? null : <p role="alert" className="is-error feed-subscribe-note">{error}</p>}
    {added === null ? null : <p role="status" className="text-meta feed-subscribe-note">加上了「{added}」</p>}
  </form>;
}
