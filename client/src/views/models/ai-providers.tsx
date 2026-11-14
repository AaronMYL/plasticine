// 设置 · AI 左边「模型」（《优化清单》第 13 条，设计稿 Settings-AI）：连着的每家一行——状态点、名字、订阅 / API key、
// n 个启用、展开后勾选要用的几个（勾了马上存，没勾的不出现在任何选择器里）；没连的收进「添加提供商」。
// 重新登录、换 key、断开在行尾 ⋯；断开先问一句。

import { useEffect, useState, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import { providerName } from './model-store.ts';
import { Connected, KeyForm, LoginFlow } from './provider-connect.tsx';
import { ProviderList, providerMoreActions, type ProviderAction } from './provider-list.tsx';

type Step = { kind: 'login' | 'key' | 'done' | 'logout'; provider: ModelProviderView } | null;

/** 模型多的那家（OpenAI 四十多个）展开后先给一个筛选框，少的不给。 */
const FILTER_FROM = 12;

function ConfirmLogout({ provider, onDone }: { provider: ModelProviderView; onDone: () => void }): ReactNode {
  const live = useLive();
  const [error, setError] = useState<string | null>(null);
  const name = providerName(provider);
  return (
    <div className="settings-confirm" role="alertdialog" aria-label={`断开 ${name}`}>
      <span className="settings-confirm-text">断开 <b>{name}</b>？用它的功能会回到默认</span>
      {error === null ? null : <span className="connect-error" role="alert">{error}</span>}
      <button type="button" className="text-button text-button-quiet" onClick={onDone}>取消</button>
      <button type="button" className="primary-button button-small" onClick={() => {
        void live.models.logout(provider.id).then((problem) => {
          setError(problem);
          if (problem === null) onDone();
        });
      }}>断开</button>
    </div>
  );
}

function EnabledModels({ provider }: { provider: ModelProviderView }): ReactNode {
  const live = useLive();
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = providerName(provider);
  const needle = filter.trim().toLowerCase();
  const shown = needle === '' ? provider.models
    : provider.models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(needle));
  const toggle = (modelId: string, on: boolean): void => {
    const next = on ? [...provider.enabled, modelId] : provider.enabled.filter((id) => id !== modelId);
    void live.models.setEnabled(provider.id, next).then(setError);
  };
  return (
    <div className="ai-provider-models">
      {provider.models.length < FILTER_FROM ? null : (
        <label className="model-search">
          <Icon name="search" size={14} />
          <input type="search" className="search-input" aria-label={`筛选 ${name} 的模型`} placeholder="筛选"
            value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
      )}
      <ul className="ai-provider-grid" aria-label={`${name} 启用的模型`}>
        {shown.map((model) => (
          <li key={model.id}>
            <label className="ai-provider-model">
              <input type="checkbox" checked={provider.enabled.includes(model.id)}
                onChange={(event) => toggle(model.id, event.target.checked)} />
              <span>{model.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {error === null ? null : <p className="settings-message" role="alert">{error}</p>}
    </div>
  );
}

function ProviderBlock({ provider, open, onToggle, onAction }: { provider: ModelProviderView; open: boolean;
  onToggle: () => void; onAction: (provider: ModelProviderView, action: ProviderAction) => void }): ReactNode {
  const name = providerName(provider);
  const bodyId = `ai-provider-${provider.id}`;
  return (
    <li className="ai-provider" aria-label={name}>
      <div className="ai-provider-head">
        <button type="button" className="ai-provider-toggle" aria-expanded={open} aria-controls={bodyId}
          onClick={onToggle}>
          <span className="dot dot-ok" role="img" aria-label="已连接" />
          <span className="ai-provider-name">{name}</span>
          <span className="ai-provider-method">{provider.connected === 'oauth' ? '订阅' : 'API key'}</span>
          <span className="ai-provider-count">{provider.enabled.length} 个启用</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        <RevealMore label={`管理 ${name}`} actions={providerMoreActions(provider, onAction)} />
      </div>
      {open ? <div id={bodyId}><EnabledModels provider={provider} /></div> : null}
    </li>
  );
}

/** 别处（设置 · AI 的「出图」那一行）请这里开始连某一家：设成那家的 id。 */
export const connectRequest = new Store<string | null>(null);

export function AiProviders({ children }: { children?: ReactNode }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const [step, setStep] = useState<Step>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const providers = data.value?.providers ?? [];
  const connected = providers.filter((item) => item.connected !== null);
  const others = providers.filter((item) => item.connected === null);
  const act = (provider: ModelProviderView, action: ProviderAction): void => setStep({ kind: action, provider });
  const requested = useStore(connectRequest);
  useEffect(() => {
    const provider = requested === null ? undefined : providers.find((item) => item.id === requested);
    if (provider === undefined) return;
    connectRequest.set(null);
    setStep({ kind: provider.methods.includes('oauth') ? 'login' : 'key', provider });
  }, [requested, providers]);
  const close = (): void => setStep(null);
  const connectedNow = (provider: ModelProviderView): void => {
    setStep({ kind: 'done', provider });
    setAdding(false);
    // 刚连上的那家展开，好接着勾要用的模型。
    setOpen((current) => new Set([...current, provider.id]));
  };
  return (
    <section className="ai-pane" aria-labelledby="ai-models-title">
      <div className="ai-pane-head">
        <h3 id="ai-models-title">模型</h3>
        <button type="button" className="secondary-button button-small" aria-expanded={adding}
          onClick={() => setAdding((value) => !value)}>
          <Icon name="plus" size={14} />添加提供商
        </button>
      </div>
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">{data.error}{' '}
          <button type="button" className="text-button" onClick={() => void live.models.reload()}>再读一次</button>
        </p>
      )}
      {adding ? (
        <div className="ai-add" role="region" aria-label="添加提供商">
          <ProviderList providers={others} onAction={act} />
        </div>
      ) : null}
      {step === null ? null : step.kind === 'logout' ? <ConfirmLogout provider={step.provider} onDone={close} /> : (
        <div className="settings-connect">
          {step.kind === 'login' ? <LoginFlow provider={step.provider}
            onDone={() => connectedNow(step.provider)} onCancel={close} /> : null}
          {step.kind === 'key' ? <KeyForm provider={step.provider}
            onDone={() => connectedNow(step.provider)} onBack={close} /> : null}
          {step.kind === 'done' ? <Connected provider={step.provider} onStart={close} onAnother={() => {
            close();
            setAdding(true);
          }} /> : null}
        </div>
      )}
      <div className="ai-list">
        <ul className="ai-provider-list" aria-label="连着的提供商">
          {connected.map((provider) => (
            <ProviderBlock key={provider.id} provider={provider} open={open.has(provider.id)} onAction={act}
              onToggle={() => setOpen((current) => {
                const next = new Set(current);
                if (!next.delete(provider.id)) next.add(provider.id);
                return next;
              })} />
          ))}
        </ul>
        {children}
      </div>
    </section>
  );
}
