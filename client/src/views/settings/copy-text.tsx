// 一句可以复制的话（邀请码那一句）：图标按钮复制，成了换成勾；浏览器不让复制时说一句，字照样选得中。

import { useEffect, useState, type ReactNode } from 'react';
import { IconButton } from '../../shell/icon-button.tsx';

export function CopyText({ text, label }: { text: string; label: string }): ReactNode {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setState('idle'), [text]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch (cause) {
      console.warn('复制没成功（浏览器不让写剪贴板）', cause);
      setState('failed');
    }
  };
  return (
    <>
      <IconButton icon={state === 'copied' ? 'check' : 'copy'} label={state === 'copied' ? '已复制' : label}
        onClick={() => void copy()} />
      {state === 'copied' ? <span className="sr-only" role="status">已复制到剪贴板</span> : null}
      {state === 'failed' ? <span className="block-empty is-error" role="alert">复制不了，选中文字手动复制。</span>
        : null}
    </>
  );
}
