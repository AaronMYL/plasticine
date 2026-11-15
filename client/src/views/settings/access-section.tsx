// 设置 · 账号 ·「在别的设备上用」（11-12《首次使用解耦》设计稿 Devices）：两种连法切换——
//   Cyber Hunter 网络：有 @账号就开着，给网址、二维码，手机扫码输密码；
//   我自己的网址：他用 Tailscale、隧道或反向代理把一个 https 网址转到这台电脑，存在这里（只收 https）。
// 常显一句后果「登录的人能用这台电脑做事」：连进来的人能替他动这台电脑，这句不收进 ⓘ。
// 11-14 设置页一种行（Aaron 弹框选）：「连法」一行下拉；网络那边「网址」一行（行尾复制）、「手机扫码」一行「二维码 ›」，
// 点开在下面出二维码；自己的网址那边框在下、「移除 · 保存」靠右。

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { AccountState, OwnUrlView } from '../../api/shared.ts';
import { QrCode } from '../contacts/qr-code.tsx';
import { CopyText } from './copy-text.tsx';
import { SectionHead } from './section-head.tsx';
import { SettingField, SettingRow, SettingSelect, ValueButton, type SelectOption } from './setting-row.tsx';
import { Failure, useRead } from './system-read.tsx';
import './access-section.css';

type Mode = 'net' | 'own';

const MODES: readonly SelectOption<Mode>[] = [{ value: 'net', label: 'Cyber Hunter 网络' },
  { value: 'own', label: '我自己的网址' }];

const OWN_URL_TIP = '用 Tailscale Serve、Cloudflare 隧道或自己的反向代理，把这个网址转到这台电脑上 Plasticine 的端口'
  + '（默认 127.0.0.1:8790）。';

function NetworkWay({ account }: { account: AccountState }): ReactNode {
  const [qr, setQr] = useState(false);
  if (account.networkUrl === null) {
    return <p className="access-empty">起了 @账号就有自己的网址，在上面账号一行起。</p>;
  }
  return (
    <>
      <SettingRow name={<span className="access-url-text">{account.networkUrl}</span>}>
        <CopyText text={account.networkUrl} label="复制网址" />
      </SettingRow>
      <SettingRow name="手机扫码登录" sub="扫了以后输入密码">
        <ValueButton label="二维码" value="二维码" expanded={qr} onClick={() => setQr(!qr)} />
      </SettingRow>
      {qr ? <div className="set-sub access-qr"><QrCode text={account.networkUrl} size={120} /></div> : null}
    </>
  );
}

function OwnWay({ saved, onSaved }: { saved: string | null; onSaved: (view: OwnUrlView) => void }): ReactNode {
  const api = useApi();
  const id = useId();
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
      <SettingField name="网址" tip={OWN_URL_TIP} htmlFor={`${id}-url`}>
        <input id={`${id}-url`} className="field-input field-input-mono" value={draft}
          placeholder="https://" inputMode="url" autoComplete="off" spellCheck={false} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} />
      </SettingField>
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <div className="set-actions">
        {saved !== null && !changed ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => save(null)}>移除</button>
        ) : null}
        <button type="submit" className="primary-button" disabled={busy || !changed}>保存</button>
      </div>
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
        <SettingSelect name="连法" value={current} options={MODES} onChange={setMode} />
        {current === 'net' ? <NetworkWay account={account.value} />
          : <OwnWay saved={ownUrl} onSaved={setSaved} />}
      </>}
    </section>
  );
}
