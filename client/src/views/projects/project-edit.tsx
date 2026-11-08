// 编辑项目：名字、截止、下一步、一句现状、状态（常驻项目只能进行）；另有档案四栏和分工各自的表单。都带 version，
// 版本旧了照样报冲突，草稿不丢（表单还开着）。

import { useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { PROJECT_LIFECYCLE_LABELS, PROJECT_LIFECYCLES } from '../../api/shared.ts';
import type { EditProjectRequest, ProjectBrief, ProjectPerson, ProjectRowView } from '../../api/shared.ts';

type Patch = Omit<EditProjectRequest, 'requestId' | 'version'>;

function useSave(row: ProjectRowView, onDone: () => void) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (patch: Patch): void => {
    setBusy(true);
    api.projects.edit(row.id, { requestId: createRequestId(), version: row.version, ...patch }).then(() => {
      setBusy(false);
      onDone();
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return { save, error, busy };
}

function Foot({ busy, error, onCancel }: { busy: boolean; error: string | null; onCancel: () => void }): ReactNode {
  return (
    <div className="proj-form-foot">
      <button type="submit" className="primary-button" disabled={busy}>保存</button>
      <button type="button" className="text-button" onClick={onCancel}>取消</button>
      {error === null ? null : <span className="proj-error" role="alert">{error}</span>}
    </div>
  );
}

export function ProjectEditForm({ row, onDone, onCancel }: {
  row: ProjectRowView; onDone: () => void; onCancel: () => void;
}): ReactNode {
  const [name, setName] = useState(row.name);
  const [due, setDue] = useState(row.due ?? '');
  const [next, setNext] = useState(row.next ?? '');
  const [status, setStatus] = useState('');
  const [lifecycle, setLifecycle] = useState(row.lifecycle);
  const { save, error, busy } = useSave(row, onDone);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save({
      name: name.trim() === '' ? row.name : name.trim(),
      due: due === '' ? null : due,
      next: next.trim() === '' ? null : next.trim(),
      ...(status.trim() === '' ? {} : { status: status.trim() }),
      ...(lifecycle === row.lifecycle ? {} : { lifecycle }),
    });
  };
  return (
    <form className="proj-edit" onSubmit={submit} aria-label="编辑项目">
      <label className="field"><span className="field-label">名字</span>
        <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span className="field-label">截止</span>
        <input className="field-input" type="date" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <label className="field"><span className="field-label">下一步</span>
        <input className="field-input" value={next} onChange={(event) => setNext(event.target.value)} /></label>
      <label className="field"><span className="field-label">写一句现状（留空就不改）</span>
        <input className="field-input" value={status} onChange={(event) => setStatus(event.target.value)} /></label>
      {row.standing ? null : (
        <div className="segmented" role="group" aria-label="状态">
          {PROJECT_LIFECYCLES.map((value) => (
            <button key={value} type="button" className="segmented-item" aria-pressed={lifecycle === value}
              onClick={() => setLifecycle(value)}>{PROJECT_LIFECYCLE_LABELS[value]}</button>
          ))}
        </div>
      )}
      <Foot busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}

export const BRIEF_FIELDS: readonly { key: keyof ProjectBrief; label: string }[] = [
  { key: 'goal', label: '目标' },
  { key: 'constraints', label: '约束' },
  { key: 'rules', label: '规矩' },
  { key: 'terms', label: '术语' },
];


export function BriefForm({ row, brief, onDone, onCancel }: {
  row: ProjectRowView; brief: ProjectBrief; onDone: () => void; onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(brief);
  const { save, error, busy } = useSave(row, onDone);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save({ brief: draft });
  };
  return (
    <form className="proj-edit" onSubmit={submit} aria-label="编辑项目档案">
      {BRIEF_FIELDS.map((field) => (
        <label key={field.key} className="field"><span className="field-label">{field.label}</span>
          <textarea className="field-input proj-textarea" rows={2} value={draft[field.key]}
            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
        </label>
      ))}
      <Foot busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}

export function PeopleForm({ row, people, onDone, onCancel }: {
  row: ProjectRowView; people: readonly ProjectPerson[]; onDone: () => void; onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState<ProjectPerson[]>([...people, { who: '', does: '' }]);
  const { save, error, busy } = useSave(row, onDone);
  const change = (index: number, patch: Partial<ProjectPerson>): void => {
    setDraft(draft.map((person, at) => (at === index ? { ...person, ...patch } : person)));
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save({ people: draft.filter((person) => person.who.trim() !== '').map((person) => ({
      who: person.who.trim(), does: person.does.trim() })) });
  };
  return (
    <form className="proj-edit" onSubmit={submit} aria-label="编辑分工">
      {draft.map((person, index) => (
        <div key={index} className="proj-person-fields">
          <input className="field-input" aria-label="谁" placeholder="谁" value={person.who}
            onChange={(event) => change(index, { who: event.target.value })} />
          <input className="field-input" aria-label="负责什么" placeholder="负责什么" value={person.does}
            onChange={(event) => change(index, { does: event.target.value })} />
        </div>
      ))}
      <button type="button" className="text-button text-button-quiet"
        onClick={() => setDraft([...draft, { who: '', does: '' }])}>再加一行</button>
      <Foot busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}
