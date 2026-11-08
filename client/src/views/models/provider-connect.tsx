// 连上一家模型的三步（2026-11-05 设计稿 Connect）：
//   登录   开始订阅登录（/v2/model-providers/:id/login）→ 在浏览器里打开授权页 →「在浏览器里登录 ChatGPT…」，
//          隔一会儿问一次走到哪了；浏览器没跳回来时把地址栏里 localhost:1455 开头的那串贴进来（说明在 ⓘ 里）；
//   填 key  一个密码框 +「连接」；
//   连上了  一个勾、「已连接」和哪一家；「开始用」「再连一家」。
// 设置 · AI 里就地展开，第一次打开 / 重新登录的连接页里一张卡一步。

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ModelProviderView, ProviderLoginView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { inDesktopApp } from '../../shell/host.ts';
import { Spinner } from '../lines/line-parts.tsx';
import { providerName } from './model-store.ts';
import { ProviderMark } from './provider-list.tsx';

/** 隔多久问一次登录走到哪了（浏览器那边授权完，服务端自己收到回调）。 */
const LOGIN_POLL_MS = 2000;
const CALLBACK_TIP = '在浏览器里登录完会跳到一个打不开的 127.0.0.1:1455 页面，把地址栏里那一整串贴到这里';

/** Mac App 里站外链接会开进 App 自己的网页标签，连接页还没进主界面、看不到那个标签，所以那里不自动打开，只给复制。 */
function inMacApp(): boolean {
  return inDesktopApp();
}

function openAuthPage(url: string | null): void {
  if (url !== null && !inMacApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

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

export function LoginFlow({ provider, onDone, onCancel }: { provider: ModelProviderView; onDone: () => void;
  onCancel: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const [login, setLogin] = useState<ProviderLoginView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callback, setCallback] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const name = providerName(provider);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.modelProviders.startLogin(provider.id, createRequestId()).then((view) => {
      setLogin(view);
      openAuthPage(view.url);
    }, (cause: unknown) => setError(errorText(cause)));
  }, [api, provider.id]);
  useEffect(() => {
    if (login === null || login.status !== 'waiting') {
      return undefined;
    }
    const timer = setInterval(() => {
      api.modelProviders.login(provider.id, login.id).then(setLogin, (cause: unknown) => setError(errorText(cause)));
    }, LOGIN_POLL_MS);
    return () => clearInterval(timer);
  }, [api, login, provider.id]);
  useEffect(() => {
    if (login?.status === 'done') {
      void live.models.reload().then(onDone);
    }
  }, [login?.status, live.models, onDone]);
  const cancel = (): void => {
    if (login !== null && login.status === 'waiting') {
      api.modelProviders.cancelLogin(provider.id, login.id, createRequestId())
        .catch((cause: unknown) => console.warn('取消登录没送到，服务端那次登录会自己过期', cause));
    }
    onCancel();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (login === null || callback.trim() === '') return;
    setBusy(true);
    api.modelProviders.completeLogin(provider.id, login.id, createRequestId(), callback.trim()).then((view) => {
      setBusy(false);
      setLogin(view);
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  const failed = error ?? login?.error ?? (login?.status === 'failed' ? '登录没成，再试一次。' : null);
  return (
    <div className="connect-step">
      <div className="connect-wait-head">
        <Spinner size={16} label="等授权" />
        <h2 className="connect-step-title">在浏览器里登录 {name}…</h2>
      </div>
      <div className="connect-links">
        <CopyLink url={login?.url ?? null} />
        {inMacApp() ? null : (
          <button type="button" className="text-button" disabled={login?.url == null}
            onClick={() => openAuthPage(login?.url ?? null)}>重新打开登录页</button>
        )}
        <button type="button" className="text-button text-button-quiet" onClick={cancel}>取消</button>
      </div>
      <div className="connect-rule" />
      <form className="connect-field" onSubmit={submit}>
        <span className="connect-label">粘贴回调地址<InfoTip label="「粘贴回调地址」的说明" text={CALLBACK_TIP} /></span>
        <input className="field-input field-input-mono" aria-label="回调地址"
          placeholder={login?.prompt?.placeholder ?? 'http://localhost:1455/auth/callback?code=…'} value={callback}
          onChange={(event) => setCallback(event.target.value)} />
        <button type="submit" className="secondary-button connect-continue" disabled={busy || callback.trim() === ''}>
          继续
        </button>
      </form>
      {failed === null ? null : <p className="connect-error" role="alert">{failed}</p>}
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

export function Connected({ provider, onStart, onAnother }: { provider: ModelProviderView; onStart: () => void;
  onAnother: () => void }): ReactNode {
  return (
    <div className="connect-step" role="status">
      <span className="connect-done-mark" role="img" aria-label="已连接"><Icon name="check" size={20} /></span>
      <div className="connect-done-text">
        <h2 className="connect-title">已连接</h2>
        <span className="connect-done-name">{providerName(provider)}</span>
      </div>
      <button type="button" className="primary-button connect-wide" onClick={onStart}>开始用</button>
      <button type="button" className="text-button text-button-quiet connect-another" onClick={onAnother}>
        再连一家
      </button>
    </div>
  );
}
