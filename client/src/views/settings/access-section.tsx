// 设置 · 账号 ·「在别的设备上用」（11-12《首次使用解耦》设计稿 Devices）：两种连法切换——
//   Cyber Hunter 网络：有 @账号就开着，给网址、二维码，手机扫码输密码；
//   我自己的网址：他用 Tailscale、隧道或反向代理把一个 https 网址转到这台电脑，存在这里（只收 https）。
// 常显一句后果「登录的人能用这台电脑做事」：连进来的人能替他动这台电脑，这句不收进 ⓘ。

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { AccountState, OwnUrlView } from '../../api/shared.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { QrCode } from '../contacts/qr-code.tsx';
import { CopyText } from './copy-text.tsx';
import { SectionHead } from './section-head.tsx';
import { Failure, useRead } from './system-read.tsx';
import './access-section.css';

type Mode = 'net' | 'own';

const OWN_URL_TIP = '用 Tailscale Serve、Cloudflare 隧道或自己的反向代理，把这个网址转到这台电脑上 Plasticine 的端口'
  + '（默认 127.0.0.1:8790）。';

function NetworkWay({ account }: { account: AccountState }): ReactNode {
  if (account.networkUrl === null) {
    return <p className="access-empty">起了 @账号就有自己的网址，在上面账号一行起。</p>;
  }
  return (
    <div className="access-net">
      <QrCode text={account.networkUrl} size={120} />
      <div className="access-net-text">
        <span className="access-url">
          <span className="access-url-text">{account.networkUrl}</span>
          <CopyText text={account.networkUrl} label="复制网址" />
        </span>
        <span className="access-hint">手机扫码，输入密码</span>
      </div>
    </div>
  );
}

function OwnWay({ saved, onSaved }: { saved: string | null; onSaved: (view: OwnUrlView) => void }): ReactNode {
  const api = useApi();
  const [draft, setDraft] = useState(saved ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(saved ?? ''), [saved]);
  const save = (value: string | null): void => {
    setBusy(true);
    setError(null);
    api.account.setOwnUrl(value).then(onSaved, (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save(draft.trim() === '' ? null : draft);
  };
  const changed = draft.trim() !== (saved ?? '');
  return (
    <form className="access-own" aria-label="我自己的网址" onSubmit={submit}>
      <span className="access-own-label">
        <label htmlFor="access-own-url" className="field-label">网址</label>
        <InfoTip label="网址的说明" text={OWN_URL_TIP} />
      </span>
      <span className="access-own-row">
        <input id="access-own-url" className="field-input field-input-mono access-own-input" value={draft}
          placeholder="https://" inputMode="url" autoComplete="off" spellCheck={false} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="primary-button button-small" disabled={busy || !changed}>保存</button>
        {saved !== null && !changed ? (
          <button type="button" className="text-button text-button-quiet" disabled={busy}
            onClick={() => save(null)}>不用了</button>
        ) : null}
      </span>
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </form>
  );
}

export function AccessSection(): ReactNode {
  const api = useApi();
  const account = useRead<AccountState>((signal) => api.account.state(signal), [api]);
  const own = useRead<OwnUrlView>((signal) => api.account.ownUrl(signal), [api]);
  const [saved, setSaved] = useState<OwnUrlView | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const ownUrl = saved?.ownUrl ?? own.value?.ownUrl ?? null;
  const current: Mode = mode ?? (ownUrl !== null ? 'own' : 'net');
  const error = account.error ?? own.error;
  return (
    <section className="block access-section" aria-labelledby="settings-access">
      <SectionHead id="settings-access" title="在别的设备上用" />
      <p className="access-warning">登录的人能用这台电脑做事。</p>
      {error === null ? null : <Failure error={error} onReload={() => { account.reload(); own.reload(); }} />}
      {account.value === null || own.value === null ? null : <>
        <div className="segmented access-modes" role="group" aria-label="连接方式">
          <button type="button" className="segmented-item" aria-pressed={current === 'net'}
            onClick={() => setMode('net')}>Cyber Hunter 网络</button>
          <button type="button" className="segmented-item" aria-pressed={current === 'own'}
            onClick={() => setMode('own')}>我自己的网址</button>
        </div>
        {current === 'net' ? <NetworkWay account={account.value} />
          : <OwnWay saved={ownUrl} onSaved={setSaved} />}
      </>}
    </section>
  );
}
