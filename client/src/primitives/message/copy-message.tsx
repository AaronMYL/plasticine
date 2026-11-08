// 复制一句话：拿到剪贴板回执才写「已复制」（图标换成勾，读屏念一句）；剪贴板不让写就就地一行原因和下一步。
// 现在只用在还没送到的那句（user-message.tsx 状态行尾）；送到了的在悬停条「⋯ · 复制」里，回执同一个样子。

import { useEffect, useState, type ReactNode } from 'react';
import { IconButton } from '../../shell/icon-button.tsx';

export function CopyMessage({ text }: { text: string }): ReactNode {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  useEffect(() => setState('idle'), [text]);
  const copy = async (): Promise<void> => {
    setState('copying');
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch (cause) {
      console.warn('复制消息没写进剪贴板', cause);
      setState('failed');
    }
  };
  return <>
    <IconButton icon={state === 'copied' ? 'check' : 'copy'} size={14} className="msg-copy"
      label={state === 'copied' ? '已复制' : '复制消息'} disabled={state === 'copying'}
      onClick={() => void copy()} />
    {state === 'copied' ? <span className="sr-only" role="status">已复制到剪贴板</span> : null}
    {state === 'failed' ? <span className="msg-copy-error" role="alert">无法复制，请选中文字手动复制。</span> : null}
  </>;
}
