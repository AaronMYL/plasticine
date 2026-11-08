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
    } catch {
      setState('failed');
    }
  };
  return <>
    <IconButton icon={state === 'copied' ? 'check' : 'copy'} className="msg-icon msg-quiet"
      label={state === 'copied' ? '已复制' : '复制消息'} disabled={state === 'copying'}
      onClick={() => void copy()} />
    {state === 'copied' ? <span className="sr-only" role="status">已复制到剪贴板</span> : null}
    {state === 'failed' ? <span className="msg-copy-error" role="alert">无法复制，请选中文字手动复制。</span> : null}
  </>;
}
