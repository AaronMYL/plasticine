// 笔记工具栏右边的保存状态（11-12 第 6 条）：平常是一个小图标，悬停说明写「已保存 · 11/12 14:19 更新」；
// 保存中转一个小圈；没保存上、结果待核实、有冲突常显文字和能点的那一步；只读写「只读」。

import type { ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import type { SaveStatus } from './note-saver.ts';

export type SaveStateKind = SaveStatus | 'readonly';

const QUIET: Partial<Record<SaveStateKind, string>> = { saved: '已保存', dirty: '未保存', saving: '保存中' };

export function SaveState({ status, when, onRetry }: { status: SaveStateKind; when: string;
  onRetry: () => void }): ReactNode {
  const quiet = QUIET[status];
  if (quiet !== undefined) {
    const tip = `${quiet} · ${when}`;
    return <span className="note-save" data-status={status} role="status" aria-label={tip} data-tip={tip} tabIndex={0}>
      {status === 'saved' ? <Icon name="cloud" size={16} /> : <span className="note-save-spin" aria-hidden="true" />}
    </span>;
  }
  if (status === 'readonly') return <span className="note-save-text" role="status">只读</span>;
  const text = status === 'failed' ? '没保存上' : status === 'uncertain' ? '结果待核实' : '有冲突';
  return <span className="note-save-text" data-status={status} role="status">
    {status === 'conflict' ? null : <Icon name="alert" size={14} />}{text}
    {status === 'conflict' ? null : <button type="button" className="text-button" onClick={onRetry}>
      {status === 'uncertain' ? '再核实' : '重试'}</button>}
  </span>;
}
