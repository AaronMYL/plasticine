// 连上一家模型的三步（2026-11-05 设计稿 Connect）：
//   登录   use-provider-login.ts：开始订阅登录 → 在浏览器里打开授权页 →「在浏览器里登录 ChatGPT…」，隔一会儿问一次
//          走到哪了；桌面客户端连远程实例时在本机等回调、自动完成；普通网页连远程实例时把地址栏里 localhost:1455
//          开头的那串贴进来（说明在 ⓘ 里）；
//   填 key  一个密码框 +「连接」；
//   连上了  一个勾、「已连接」和哪一家；「开始用」「再连一家」。
// 设置 · AI 里就地展开，第一次打开 / 重新登录的连接页里一张卡一步。

import { useState, type FormEvent, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { Spinner } from '../lines/line-parts.tsx';
import { providerName } from './model-store.ts';
import { ProviderMark } from './provider-list.tsx';
import { useProviderLogin, type ProviderLogin } from './use-provider-login.ts';

const CALLBACK_TIP = '在浏览器里登录完会跳到一个打不开的 127.0.0.1:1455 页面，把地址栏里那一整串贴到这里';

function CopyLink({ url }: { url: string | null }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    if (url === null) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, (cause: unknown) => console.warn('复制登录链接没成', cause));
  };
  return (
    <button type="button" className="text-button" disabled={url === null} onClick={copy}>
      {copied ? '已复制' : '复制登录链接'}
    </button>
  );
}

/** 贴回调地址（普通网页连远程实例、旧 Mac App）：说明在 ⓘ 里。 */
export function CallbackForm({ flow }: { flow: ProviderLogin }): ReactNode {
  const [callback, setCallback] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    flow.complete(callback);
  };
  return (
    <form className="connect-field" onSubmit={submit}>
      <span className="connect-label">粘贴回调地址<InfoTip label="「粘贴回调地址」的说明" text={CALLBACK_TIP} /></span>
      <input className="field-input field-input-mono" aria-label="回调地址"
        placeholder={flow.login?.prompt?.placeholder ?? 'http://localhost:1455/auth/callback?code=…'} value={callback}
        onChange={(event) => setCallback(event.target.value)} />
      <button type="submit" className="secondary-button connect-continue"
        disabled={flow.busy || callback.trim() === ''}>继续</button>
    </form>
  );
}

export function LoginFlow({ provider, onDone, onCancel }: { provider: ModelProviderView; onDone: () => void;
  onCancel: () => void }): ReactNode {
  const flow = useProviderLogin(provider, onDone, onCancel);
  const name = providerName(provider);
  const paste = flow.route === 'paste' || flow.route === 'copy';
  return (
    <div className="connect-step">
      <div className="connect-wait-head">
        <Spinner size={16} label="等授权" />
        <h2 className="connect-step-title">在浏览器里登录 {name}…</h2>
      </div>
      <div className="connect-links">
        {flow.route === 'copy' ? <CopyLink url={flow.login?.url ?? null} /> : (
          <button type="button" className="text-button" disabled={flow.login?.url == null}
            onClick={flow.reopen}>重新打开登录页</button>
        )}
        <button type="button" className="text-button text-button-quiet" onClick={flow.cancel}>取消</button>
      </div>
      {paste ? <><div className="connect-rule" /><CallbackForm flow={flow} /></> : null}
      {flow.error === null ? null : <p className="connect-error" role="alert">{flow.error}</p>}
    </div>
  );
}

export function KeyForm({ provider, onDone, onBack }: { provider: ModelProviderView; onDone: () => void;
  onBack: () => void }): ReactNode {
  const live = useLive();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (key.trim() === '') return;
    setBusy(true);
    void live.models.setKey(provider.id, key.trim()).then((problem) => {
      setBusy(false);
      setError(problem);
      if (problem === null) onDone();
    });
  };
  return (
    <form className="connect-step" onSubmit={submit}>
      <div className="connect-key-head">
        <IconButton icon="back" label="返回" onClick={onBack} />
        <ProviderMark provider={provider} />
        <h2 className="connect-step-title">{providerName(provider)}</h2>
      </div>
      <label className="connect-field">
        <span className="connect-label">API Key</span>
        <input className="field-input field-input-mono" type="password" autoComplete="off" autoFocus value={key}
          onChange={(event) => setKey(event.target.value)} />
      </label>
      <button type="submit" className="primary-button connect-wide" disabled={busy || key.trim() === ''}>连接</button>
      {error === null ? null : <p className="connect-error" role="alert">{error}</p>}
    </form>
  );
}

export function Connected({ provider, onStart, onAnother, startLabel = '开始用' }: { provider: ModelProviderView;
  onStart: () => void; onAnother: () => void; startLabel?: string }): ReactNode {
  return (
    <div className="connect-step" role="status">
      <span className="connect-done-mark" role="img" aria-label="已连接"><Icon name="check" size={20} /></span>
      <div className="connect-done-text">
        <h2 className="connect-title">已连接</h2>
        <span className="connect-done-name">{providerName(provider)}</span>
      </div>
      <button type="button" className="primary-button connect-wide" onClick={onStart}>{startLabel}</button>
      <button type="button" className="text-button text-button-quiet connect-another" onClick={onAnother}>
        再连一家
      </button>
    </div>
  );
}
