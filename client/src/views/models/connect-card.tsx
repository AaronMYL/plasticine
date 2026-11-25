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

export function noModelConnected(providers: readonly ModelProviderView[] | undefined): boolean {
  return providers !== undefined && providers.length > 0 && providers.every((item) => item.connected === null);
}

async function ensureDefault(live: ReturnType<typeof useLive>, provider: ModelProviderView): Promise<void> {
  const value = live.models.store.get().value;
  const model = value?.providers.find((item) => item.id === provider.id)?.models[0] ?? provider.models[0];
  if (value === null || value.effective !== null || model === undefined) return;
  await live.models.choose({ provider: provider.id, model: model.id, thinking: DEFAULT_THINKING });
}

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
