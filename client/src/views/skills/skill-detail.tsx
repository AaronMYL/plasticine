// 一个技能：叫什么、什么时候用、用过几次、哪来的、方法全文；不是随应用的能删（先弹确认框写清后果）。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SkillRow } from '../../api/shared.ts';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { SkillReader } from './skill-reader.tsx';
import { SOURCE_LABELS, originText, skillLabel } from './skill-text.ts';

/** 删一个技能：挪出目录留底；正在用它的线照旧用已经加载的那一版。 */
function ConfirmRemove({ skill, onDone, onCancel }: { skill: SkillRow; onDone: () => void; onCancel: () => void })
  : ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = skillLabel(skill);
  return (
    <ConfirmDialog title={`删除「${label}」？`} body="以后 Plasticine 不再选用它；正在用它的线不受影响。"
      confirmLabel="删除" busy={busy} error={error} onCancel={onCancel} onConfirm={() => {
        setBusy(true);
        api.skills.remove(skill.name, createRequestId()).then(onDone, (cause: unknown) => {
          setBusy(false);
          setError(errorText(cause));
        });
      }} />
  );
}

export function SkillDetail({ skill, onRemoved }: { skill: SkillRow; onRemoved: () => void }): ReactNode {
  const [removing, setRemoving] = useState(false);
  const label = skillLabel(skill);
  return <article className="skill-detail" aria-label={label}>
    <header className="skill-detail-head">
      <h2>{label}</h2>
      <span className="tag tag-neutral">{SOURCE_LABELS[skill.source.kind]}</span>
      <span className="skills-gap" />
      {skill.source.kind === 'builtin' ? null : <IconButton icon="trash" label={`删除「${label}」`}
        aria-expanded={removing} onClick={() => setRemoving(true)} />}
    </header>
    {label === skill.name ? null : <p className="skill-detail-name">{skill.name}</p>}
    {skill.description === '' ? null : <p className="skill-detail-desc">{skill.description}</p>}
    {removing ? <ConfirmRemove skill={skill} onCancel={() => setRemoving(false)} onDone={onRemoved} /> : null}
    <p className="skill-detail-meta">
      <span>{skill.uses === 0 ? '还没用过' : `用过 ${skill.uses} 次`}</span>
      {skill.lastUsedAt === null ? null : <span>上次 {relativeTime(skill.lastUsedAt, new Date())}</span>}
      <span>{originText(skill.source)}</span>
    </p>
    <SkillReader key={`${skill.name}:${skill.version}`} descriptor={skill} />
  </article>;
}
