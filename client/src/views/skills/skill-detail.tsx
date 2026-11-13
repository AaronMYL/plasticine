// 一个技能：叫什么、什么时候用、用过几次、哪来的、方法全文；不是随应用的能删（后果常显，点了才删）。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SkillRow } from '../../api/shared.ts';
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
    <div className="skill-confirm" role="alertdialog" aria-label={`删除「${label}」`}>
      <span className="skill-confirm-text">删除 <b>{label}</b>？以后 Plasticine 不再选用；正在用它的线不受影响</span>
      {error === null ? null : <span className="skills-error" role="alert">{error}</span>}
      <button type="button" className="text-button text-button-quiet" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="primary-button button-small" disabled={busy} onClick={() => {
        setBusy(true);
        api.skills.remove(skill.name, createRequestId()).then(onDone, (cause: unknown) => {
          setBusy(false);
          setError(errorText(cause));
        });
      }}>删除</button>
    </div>
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
