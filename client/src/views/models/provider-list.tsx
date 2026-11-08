// 模型提供商的平级列表（2026-11-05 设计稿 Settings-AI / Connect）：一家一行——标记块 · 名字（连上了下面一行 ● 怎么连的）·
// 「登录」/「填 key」，连上了的是 ⋯（重新登录、换 key、断开）。常用的几家先列，其余收在「更多 n 家」里。
// 点「登录」「填 key」交给调用方（设置里就地展开，连接页换到下一张卡）。

import { useState, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
import { arrangeProviders, providerMark, providerName } from './model-store.ts';

export type ProviderAction = 'login' | 'key' | 'logout';

/** 这一家先给哪个按钮：有订阅登录的写「登录」，只能填 key 的写「填 key」。 */
export function primaryAction(provider: ModelProviderView): 'login' | 'key' {
  return provider.methods.includes('oauth') ? 'login' : 'key';
}

/** 连上了的那家写明是哪个连接：订阅的账号和套餐，或 key 的最后 4 位。 */
function connectedText(provider: ModelProviderView): string {
  if (provider.connected === 'oauth') {
    const who = [provider.account, provider.plan === null ? null : provider.plan.toUpperCase()]
      .filter((part) => part !== null);
    return who.length === 0 ? '已登录' : who.join(' · ');
  }
  return provider.keyLast4 === null ? '已填 key' : `key …${provider.keyLast4}`;
}

export function ProviderMark({ provider, size = 28 }: { provider: ModelProviderView; size?: number }): ReactNode {
  return (
    <span className="provider-mark" style={{ width: size, height: size }} aria-hidden="true">
      {providerMark(provider)}
    </span>
  );
}

/** 连上了的那家行尾 ⋯ 里的：重新登录、换 key、断开。 */
export function providerMoreActions(provider: ModelProviderView,
  onAction: (provider: ModelProviderView, action: ProviderAction) => void): RevealAction[] {
  return [
    ...(provider.methods.includes('oauth') ? [{ icon: 'refresh' as const, label: '重新登录',
      onSelect: () => onAction(provider, 'login') }] : []),
    ...(provider.methods.includes('api_key') ? [{ icon: 'edit' as const, label: '换 key',
      onSelect: () => onAction(provider, 'key') }] : []),
    { icon: 'close', label: '断开', onSelect: () => onAction(provider, 'logout') },
  ];
}

/** 一家正在连（在浏览器里登录…）：那一行行尾换成这一块。 */
export interface ProviderPending {
  id: string;
  node: ReactNode;
}

function ProviderRow({ provider, onAction, compact, pending }: { provider: ModelProviderView;
  onAction: (provider: ModelProviderView, action: ProviderAction) => void; compact: boolean;
  pending: ReactNode | null }): ReactNode {
  const name = providerName(provider);
  const more = providerMoreActions(provider, onAction);
  const action = primaryAction(provider);
  return (
    <li className="provider-row" data-compact={compact} aria-label={name}>
      <ProviderMark provider={provider} />
      <span className="provider-main">
        <span className="provider-name">{name}</span>
        {provider.connected === null ? null : (
          <span className="provider-state"><span className="dot dot-ok" aria-hidden="true" />
            {connectedText(provider)}</span>
        )}
      </span>
      {pending !== null ? pending : provider.connected === null ? (
        <button type="button" className="secondary-button button-small" onClick={() => onAction(provider, action)}>
          {action === 'login' ? '登录' : '填 key'}
        </button>
      ) : <RevealMore label={`管理 ${name}`} actions={more} />}
    </li>
  );
}

export function ProviderList({ providers, onAction, columns = 1, compact = false, pending = null }: {
  providers: readonly ModelProviderView[];
  onAction: (provider: ModelProviderView, action: ProviderAction) => void;
  columns?: 1 | 2;
  /** 连接页（设计稿 Connect-Model）：行矮一点，「其他 n 家」是最后一行。 */
  compact?: boolean;
  pending?: ProviderPending | null;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const { featured, more } = arrangeProviders(providers);
  const shown = expanded ? [...featured, ...more] : featured;
  const rowMore = compact && !expanded && more.length > 0;
  return (
    <div className="provider-list-wrap">
      <ul className="provider-list" data-columns={columns} aria-label="模型提供商">
        {shown.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} onAction={onAction} compact={compact}
            pending={pending?.id === provider.id ? pending.node : null} />
        ))}
        {rowMore ? (
          <li className="provider-row" data-compact="true">
            <button type="button" className="provider-more-row" aria-expanded={false}
              onClick={() => setExpanded(true)}>
              <span className="provider-mark" aria-hidden="true"><Icon name="plus" size={14} /></span>
              <span className="provider-name">其他 {more.length} 家</span>
              <Icon name="chevron-right" size={14} />
            </button>
          </li>
        ) : null}
      </ul>
      {more.length === 0 || rowMore ? null : (
        <button type="button" className="text-button text-button-quiet provider-more" aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : `更多 ${more.length} 家`}
        </button>
      )}
    </div>
  );
}
