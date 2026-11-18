// 设置 · AI 左边「模型」（《优化清单》第 13 条，设计稿 Settings-AI）：连着的每家一行——状态点、名字、订阅 / API key、
// n 个启用、展开后勾选要用的几个（勾了马上存，没勾的不出现在任何选择器里）；没连的收进「添加提供商」。
// 重新登录、换 key、断开在行尾 ⋯；断开先弹确认框写清后果。
// 自定义提供商（11-16）：「添加提供商」最后一行进；连着的那一行写「自定义」，⋯ 里是编辑、测试连接、删除。

import { useEffect, useState, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import { providerName } from './model-store.ts';
import { Connected, KeyForm, LoginFlow } from './provider-connect.tsx';
import { CustomProviderForm } from './custom-provider-form.tsx';
import { ProviderList, providerMoreActions, type ProviderAction } from './provider-list.tsx';
import type { RevealAction } from '../../shell/reveal-more.tsx';
import { SearchField } from '../../primitives/search-field/index.tsx';

type Step = { kind: 'login' | 'key' | 'done' | 'logout' | 'remove'; provider: ModelProviderView }
  | { kind: 'custom'; provider: ModelProviderView | null; autoTest: boolean } | null;
type BlockAction = ProviderAction | 'edit' | 'test' | 'remove';

/** 模型多的那家（OpenAI 四十多个）展开后先给一个筛选框，少的不给。 */
const FILTER_FROM = 12;

function ConfirmLogout({ provider, onDone }: { provider: ModelProviderView; onDone: () => void }): ReactNode {
  const live = useLive();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = providerName(provider);
  return (
    <ConfirmDialog title={`断开 ${name}？`} body="用它的功能会回到默认模型；要再用得重新登录或填 key。"
      confirmLabel="断开" busy={busy} error={error} onCancel={onDone} onConfirm={() => {
        setBusy(true);
        void live.models.logout(provider.id).then((problem) => {
          setBusy(false);
          setError(problem);
          if (problem === null) onDone();
        });
      }} />
  );
}

function ConfirmRemove({ provider, onDone }: { provider: ModelProviderView; onDone: () => void }): ReactNode {
  const live = useLive();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog title={`删除 ${provider.name}？`} body="地址、模型和 key 都会删除；用它的功能回到默认模型。"
      confirmLabel="删除" busy={busy} error={error} onCancel={onDone} onConfirm={() => {
        setBusy(true);
        void live.models.removeCustom(provider.id).then((problem) => {
          setBusy(false);
          setError(problem);
          if (problem === null) onDone();
        });
      }} />
  );
}

/** 自定义的那家行尾 ⋯：编辑、测试连接、删除。 */
function customActions(onAction: (action: BlockAction) => void): RevealAction[] {
  return [
    { icon: 'edit', label: '编辑', onSelect: () => onAction('edit') },
    { icon: 'pulse', label: '测试连接', onSelect: () => onAction('test') },
    { icon: 'trash', label: '删除', danger: true, onSelect: () => onAction('remove') },
  ];
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
        <SearchField label={`筛选 ${name} 的模型`} placeholder="筛选" value={filter} onChange={setFilter} />
      )}
      <ul className="ai-provider-grid" aria-label={`${name} 启用的模型`}>
        {shown.map((model) => (
          <li key={model.id}>
            <label className="ai-provider-model">
              <input type="checkbox" checked={provider.enabled.includes(model.id)}
                onChange={(event) => toggle(model.id, event.target.checked)} />
              <span>{model.name}</span>
              {model.estimated === true
                ? <span className="ai-provider-model-note" title="账号列出来、模型库里还没有的新型号：价格照同系列旧型号估的">
                  价格照旧型号估的</span> : null}
            </label>
          </li>
        ))}
      </ul>
      {error === null ? null : <p className="settings-message" role="alert">{error}</p>}
    </div>
  );
}

function methodText(provider: ModelProviderView): string {
  if (provider.custom !== null) return '自定义';
  return provider.connected === 'oauth' ? '订阅' : 'API key';
}

function ProviderBlock({ provider, open, onToggle, onAction }: { provider: ModelProviderView; open: boolean;
  onToggle: () => void; onAction: (provider: ModelProviderView, action: BlockAction) => void }): ReactNode {
  const name = providerName(provider);
  const bodyId = `ai-provider-${provider.id}`;
  const actions = provider.custom === null ? providerMoreActions(provider, onAction)
    : customActions((action) => onAction(provider, action));
  return (
    <li className="ai-provider" aria-label={name}>
      <div className="ai-provider-head">
        <button type="button" className="ai-provider-toggle" aria-expanded={open} aria-controls={bodyId}
          onClick={onToggle}>
          <span className="dot dot-ok" role="img" aria-label="已连接" />
          <span className="ai-provider-name">{name}</span>
          <span className="ai-provider-method">{methodText(provider)}</span>
          <span className="ai-provider-count">{provider.enabled.length} 个启用</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        <RevealMore label={`管理 ${name}`} actions={actions} />
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
  const act = (provider: ModelProviderView, action: BlockAction): void => {
    if (action === 'edit' || action === 'test') {
      setStep({ kind: 'custom', provider, autoTest: action === 'test' });
    } else {
      setStep({ kind: action, provider });
    }
  };
  const customRow = (
    <li className="provider-row" aria-label="自定义提供商">
      <span className="provider-mark" aria-hidden="true"><Icon name="sliders" size={14} /></span>
      <span className="provider-main"><span className="provider-name">自定义提供商</span></span>
      <button type="button" className="secondary-button button-small"
        onClick={() => {
          setAdding(false);
          setStep({ kind: 'custom', provider: null, autoTest: false });
        }}>添加</button>
    </li>
  );
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
          <ProviderList providers={others} onAction={act} extra={customRow} />
        </div>
      ) : null}
      {step?.kind === 'logout' ? <ConfirmLogout provider={step.provider} onDone={close} /> : null}
      {step?.kind === 'remove' ? <ConfirmRemove provider={step.provider} onDone={close} /> : null}
      {step === null || step.kind === 'logout' || step.kind === 'remove' ? null : (
        <div className="settings-connect">
          {step.kind === 'custom' ? <CustomProviderForm key={step.provider?.id ?? 'new'} provider={step.provider}
            autoTest={step.autoTest} onCancel={close} onDone={(id) => {
              close();
              setAdding(false);
              if (id !== null) setOpen((current) => new Set([...current, id]));
            }} /> : null}
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
