// 设置里指到记忆页的一行（记忆分层，11-15）：授权清单挪到了记忆 · 承诺和授权，通知哪些事挪到了记忆 · 主动告诉你，
// 原处只留一行链接。点了换地址过去，设置弹框跟着收起（use-settings-dialog.tsx：地址不再是设置就离开）。

import type { ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import { routeHash } from '../../shell/routes.ts';
import { SettingRow } from './setting-row.tsx';

export function MemoryLinkRow({ name, topicId, page }: { name: string; topicId: string; page: string }): ReactNode {
  return (
    <SettingRow name={name}>
      <a className="set-value" aria-label={`${name}：在记忆 · ${page}`}
        href={routeHash({ view: 'memory', noteId: null, topicId })}>
        <span>记忆 · {page}</span><Icon name="chevron-right" size={14} />
      </a>
    </SettingRow>
  );
}
