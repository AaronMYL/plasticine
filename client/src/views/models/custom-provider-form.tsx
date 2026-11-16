// 自定义提供商（11-16 Aaron，设计稿弹框定「按这个做」）：名称、接口协议、Base URL、API Key、模型（一个个加，或从接口
// 读出来挑；每个模型标能不能思考、能不能看图、上下文多长）；底部「测试连接」和「保存」。测试用表单里还没保存的配置，
// 每个模型都试一句，结果每一步一行：成了打勾，没成写原因和服务端原话。
// 设置 · AI 里就地展开（新建从「添加提供商」最后一行进，改从那一家行尾 ⋯ 进）。

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  CUSTOM_PROTOCOL_LABELS, CUSTOM_PROTOCOLS, MAX_TESTED_MODELS, type CustomModel, type CustomProtocol,
  type ModelProviderView, type TestModelConnectionResponse,
} from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { BusyText } from '../../primitives/busy/index.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { ConnectionResult } from './connection-result.tsx';
import { ModelRows } from './model-rows.tsx';
import './custom-provider.css';

export interface CustomProviderFormProps {
  /** 改哪一家；新建是 null。 */
  provider: ModelProviderView | null;
  /** 打开就先测一次（行尾 ⋯ 的「测试连接」）。 */
  autoTest?: boolean;
  onDone: (providerId: string | null) => void;
  onCancel: () => void;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/[^/\s]+/.test(value.trim());
}

export function CustomProviderForm({ provider, autoTest = false, onDone, onCancel }: CustomProviderFormProps):
  ReactNode {
  const live = useLive();
  const [name, setName] = useState(provider?.name ?? '');
  const [protocol, setProtocol] = useState<CustomProtocol>(provider?.custom?.protocol ?? 'openai-completions');
  const [baseUrl, setBaseUrl] = useState(provider?.custom?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<CustomModel[]>(provider?.models.map((model) => ({ id: model.id,
    reasoning: model.reasoning, images: model.input.includes('image'), contextWindow: model.contextWindow })) ?? []);
  const [listed, setListed] = useState<TestModelConnectionResponse['models']>(null);
  const [result, setResult] = useState<TestModelConnectionResponse | string | null>(null);
  const [testing, setTesting] = useState<'test' | 'list' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tested = useRef(false);
  const self = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // 在长长的设置页里就地展开：滚到看得见。
    self.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);
  const canReach = looksLikeUrl(baseUrl);
  const canSave = name.trim() !== '' && canReach && models.length > 0 && !saving;
  const keyHint = provider === null ? '' : provider.keyLast4 === null ? '留空不改' : `已填 …${provider.keyLast4}，留空不改`;

  /** 改了地址、协议、key，上次测的结果就不算数了。 */
  const edited = <T,>(set: (value: T) => void) => (value: T): void => {
    set(value);
    setResult(null);
  };

  const test = (mode: 'test' | 'list'): void => {
    setTesting(mode);
    setResult(null);
    void live.models.testConnection({ providerId: provider?.id ?? null, protocol, baseUrl: baseUrl.trim(),
      ...(apiKey.trim() === '' && provider !== null ? {} : { apiKey: apiKey.trim() }),
      ...(mode === 'test' ? { models: models.slice(0, MAX_TESTED_MODELS) } : {}) }).then((outcome) => {
      setTesting(null);
      setResult(outcome);
      if (typeof outcome !== 'string' && outcome.models !== null) setListed(outcome.models);
    });
  };

  useEffect(() => {
    if (!autoTest || tested.current || !canReach) return;
    tested.current = true;
    test('test');
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    void live.models.saveCustom({ id: provider?.id ?? null, name: name.trim(), protocol, baseUrl: baseUrl.trim(),
      ...(apiKey.trim() === '' && provider !== null ? {} : { apiKey: apiKey.trim() }), models }).then((saved) => {
      setSaving(false);
      setError(saved.problem);
      if (saved.problem === null) onDone(saved.id);
    });
  };

  return (
    <form ref={self} className="connect-step custom-provider" onSubmit={submit} aria-label="自定义提供商">
      <div className="connect-key-head">
        <IconButton icon="back" label="返回" onClick={onCancel} />
        <h2 className="connect-step-title">{provider === null ? '自定义提供商' : `编辑 ${provider.name}`}</h2>
      </div>
      <label className="connect-field">
        <span className="connect-label">名称</span>
        <input className="field-input" value={name} maxLength={40} autoFocus={provider === null}
          placeholder="比如 My Gateway" onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="connect-field">
        <span className="connect-label" id="custom-protocol-label">接口协议</span>
        <div className="segmented" role="group" aria-labelledby="custom-protocol-label">
          {CUSTOM_PROTOCOLS.map((item) => (
            <button key={item} type="button" className="segmented-item" aria-pressed={protocol === item}
              onClick={() => edited(setProtocol)(item)}>{CUSTOM_PROTOCOL_LABELS[item]}</button>
          ))}
        </div>
      </div>
      <label className="connect-field">
        <span className="connect-label">Base URL</span>
        <input className="field-input field-input-mono" value={baseUrl} inputMode="url" spellCheck={false}
          placeholder="https://api.example.com/v1" onChange={(event) => edited(setBaseUrl)(event.target.value)} />
      </label>
      <label className="connect-field">
        <span className="connect-label">API Key</span>
        <input className="field-input field-input-mono" type="password" autoComplete="off" value={apiKey}
          placeholder={keyHint} onChange={(event) => edited(setApiKey)(event.target.value)} />
      </label>
      <ModelRows models={models} listed={listed} listing={testing === 'list'} canList={canReach && testing === null}
        onChange={(next) => {
          setModels(next);
          setResult(null);
        }} onList={() => test('list')} />
      <div className="custom-provider-foot">
        <button type="button" className="secondary-button" disabled={!canReach || models.length === 0
          || testing !== null} onClick={() => test('test')}>
          <BusyText busy={testing === 'test'} label="正在测试">测试连接</BusyText>
        </button>
        <span className="custom-provider-foot-end">
          <button type="button" className="text-button text-button-quiet" onClick={onCancel}>取消</button>
          <button type="submit" className="primary-button" disabled={!canSave}>
            <BusyText busy={saving} label="正在保存">保存</BusyText>
          </button>
        </span>
      </div>
      {result === null ? null : <ConnectionResult result={result} />}
      {error === null ? null : <p className="connect-error" role="alert">{error}</p>}
    </form>
  );
}
