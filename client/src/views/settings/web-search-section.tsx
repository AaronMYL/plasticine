import { useEffect, useState, type ReactNode } from 'react';
import type { WebSearchStatus } from '../../api/shared.ts';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { useTimeZone } from '../../live.tsx';
import { BusyText } from '../../primitives/busy/index.tsx';
import { timeText } from '../../shell/time-text.ts';
import { SectionHead } from './section-head.tsx';
import { SettingField, SettingRow } from './setting-row.tsx';

function statusText(status: WebSearchStatus, timeZone: string): string {
  if (!status.configured) return '还没填密钥：没填时 Plasticine 只能开浏览器一页页翻。';
  const used = `本月 ${status.usedThisMonth} / ${status.monthlyFree} 次`;
  if (status.testedAt === null) return `已填 ${status.keyHint ?? ''} · 还没测过 · ${used}`;
  const when = timeText(status.testedAt, new Date(), timeZone);
  return `${status.testOk === true ? '连上了' : '没连上'} · ${when} 测过 · ${used}`;
}

export function WebSearchSection(): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const [status, setStatus] = useState<WebSearchStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.webSearch.status(controller.signal).then(setStatus, (cause: unknown) => {
      if (!controller.signal.aborted) setError(`没读到网络搜索设置：${errorText(cause)}`);
    });
    return () => controller.abort();
  }, [api]);
  const run = (what: 'save' | 'test' | 'clear', work: () => Promise<WebSearchStatus>): void => {
    setBusy(what);
    setError(null);
    work().then((next) => {
      setStatus(next);
      if (what === 'save') setKey('');
    }, (cause: unknown) => setError(errorText(cause))).finally(() => setBusy(null));
  };
  const save = (apiKey: string | null): Promise<WebSearchStatus> =>
    api.webSearch.save({ requestId: createRequestId(), provider: 'tavily', apiKey });
  const test = (): Promise<WebSearchStatus> => api.webSearch.test({ requestId: createRequestId() }).then((result) => {
    if (!result.ok) setError(result.error ?? '没连上。');
    return result.status;
  });
  return (
    <section className="block" aria-labelledby="settings-web-search">
      <SectionHead id="settings-web-search" title="网络搜索" />
      <SettingRow name="服务" tip="Plasticine 搜索、读网页正文用它；免费档每月 1000 次。" sub={status === null ? null
        : statusText(status, timeZone)}>
        <span>Tavily</span>
      </SettingRow>
      <SettingField name="密钥" htmlFor="web-search-key">
        <form className="set-key-form" onSubmit={(event) => {
          event.preventDefault();
          if (key.trim() !== '') run('save', () => save(key.trim()));
        }}>
          <input id="web-search-key" className="field-input" type="password" autoComplete="off" value={key}
            placeholder={status?.configured === true ? `已填 ${status.keyHint ?? ''}，要换就填新的` : 'tvly-…'}
            onChange={(event) => setKey(event.currentTarget.value)} />
          <button type="submit" className="secondary-button" disabled={busy !== null || key.trim().length < 8}>
            <BusyText busy={busy === 'save'}>保存</BusyText>
          </button>
          <button type="button" className="secondary-button" disabled={busy !== null || status?.configured !== true}
            onClick={() => run('test', test)}><BusyText busy={busy === 'test'}>测试</BusyText></button>
          {status?.configured === true ? <button type="button" className="text-button" disabled={busy !== null}
            onClick={() => run('clear', () => save(null))}>清掉</button> : null}
        </form>
      </SettingField>
      {error === null ? null : <p className="set-error" role="alert">{error}</p>}
    </section>
  );
}
