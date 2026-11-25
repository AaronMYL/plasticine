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
