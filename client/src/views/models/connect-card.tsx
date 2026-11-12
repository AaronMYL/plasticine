// 连上一个模型（2026-11-12《首次使用解耦》）：主线欢迎卡里的那一张，和别处用到模型时弹的小窗（connect-sheet.tsx）共用。
// 平级提供商列表；点「登录」那一行行尾是「在浏览器里登录…」，列表下面常显「复制登录链接 · 取消」和「粘贴回调地址」
// （Aaron：模型配置一定要有复制登录链接和回调粘贴）；点「填 key」换成填 key。连上了先保证有能用的默认模型，再交给
// 调用方（收成一行、关小窗、接着发原话）。不再挡整窗：一家都没连也照常进，用到时再连。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_THINKING, type ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { useStore } from '../../state/use-store.ts';
import { Spinner } from '../lines/line-parts.tsx';
import { CallbackForm, CopyLink, KeyForm } from './provider-connect.tsx';
import { ProviderList, type ProviderAction } from './provider-list.tsx';
import { useProviderLogin } from './use-provider-login.ts';
import './models.css';

type Step = { kind: 'choose' } | { kind: 'login' | 'key'; provider: ModelProviderView };

/** 一家都没连上（或者连接状态还没读到）。 */
export function noModelConnected(providers: readonly ModelProviderView[] | undefined): boolean {
  return providers !== undefined && providers.length > 0 && providers.every((item) => item.connected === null);
}

/** 连上以后还没有能用的默认模型（这家的模型一个都没启用）：先用这家的第一个，免得进去了也用不了。 */
async function ensureDefault(live: ReturnType<typeof useLive>, provider: ModelProviderView): Promise<void> {
  const value = live.models.store.get().value;
  const model = value?.providers.find((item) => item.id === provider.id)?.models[0] ?? provider.models[0];
  if (value === null || value.effective !== null || model === undefined) return;
  await live.models.choose({ provider: provider.id, model: model.id, thinking: DEFAULT_THINKING });
}

/** 一家在浏览器里登录：复制登录链接、取消、粘贴回调地址都常显；出错一行。列表那一行行尾的「取消」经 cancelRef 调到这里。 */
function LoginPanel({ provider, onDone, onCancel, cancelRef }: { provider: ModelProviderView; onDone: () => void;
  onCancel: () => void; cancelRef: { current: (() => void) | null } }): ReactNode {
  const flow = useProviderLogin(provider, onDone, onCancel);
  useEffect(() => {
    cancelRef.current = flow.cancel;
  });
  useEffect(() => () => {
    cancelRef.current = null;
  }, [cancelRef]);
  return (
    <div className="connect-login">
      <div className="connect-links">
        <CopyLink url={flow.login?.url ?? null} />
        <button type="button" className="text-button text-button-quiet" onClick={flow.cancel}>取消</button>
      </div>
      <CallbackForm flow={flow} />
      {flow.error === null ? null : <p className="connect-error" role="alert">{flow.error}</p>}
    </div>
  );
}

export function ConnectCard({ onConnected }: { onConnected: (provider: ModelProviderView) => void }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const providers = data.value?.providers ?? [];
  useEffect(() => {
    void live.models.reload();
  }, [live.models]);
  const finish = useCallback((provider: ModelProviderView) => {
    void ensureDefault(live, provider).finally(() => onConnected(provider));
  }, [live, onConnected]);
  const pick = (provider: ModelProviderView, action: ProviderAction): void => {
    if (action === 'logout') {
      void live.models.logout(provider.id);
      return;
    }
    setStep({ kind: action, provider });
  };
  const loggingIn = step.kind === 'login' ? step.provider : null;
  const done = useCallback(() => {
    if (loggingIn !== null) finish(loggingIn);
  }, [finish, loggingIn]);
  const back = useCallback(() => setStep({ kind: 'choose' }), []);
  const cancelRef = useRef<(() => void) | null>(null);
  const pending = loggingIn === null ? null : { id: loggingIn.id, node: (
    <span className="ob-row-wait" role="status">
      <Spinner size={12} label="等授权" />在浏览器里登录…
      <IconButton icon="close" label="取消登录" size={14} onClick={() => {
        if (cancelRef.current === null) back();
        else cancelRef.current();
      }} />
    </span>
  ) };
  if (step.kind === 'key') {
    return <KeyForm provider={step.provider} onDone={() => finish(step.provider)} onBack={back} />;
  }
  return (
    <div className="connect-card-body">
      <ProviderList providers={providers} onAction={pick} compact pending={pending} />
      {loggingIn === null ? null : <LoginPanel key={loggingIn.id} provider={loggingIn} onDone={done}
        onCancel={back} cancelRef={cancelRef} />}
    </div>
  );
}
