// 新建技能：说一句想让 Plasticine 学会什么（或挑一件做成过的事），Plasticine 写出草稿，改完保存；也可以自己从空白写。
// 草稿不存：保存了才进目录。「保存并试一次」存好以后把一句话放进主线的输入框，发不发由你。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { MAIN_LINE_ALIAS, SKILL_BODY_MAX_CHARS, SKILL_SAID_MAX_CHARS, SKILL_TITLE_MAX_CHARS, type SkillDraft,
  type SkillRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { mainLineRoute, type Route } from '../../shell/routes.ts';
import { SKILL_NAME_PATTERN } from './skill-text.ts';

export interface SkillsNewProps {
  phone: boolean;
  /** 一次只放一栏（手机，或电脑上主区窄）：草稿出来以后只画草稿。 */
  single: boolean;
  navigate: (route: Route) => void;
  onBack: () => void;
  onSaved: (skill: SkillRow) => void;
}

type Mode = 'tell' | 'write';
const EMPTY: SkillDraft = { title: '', name: '', description: '', body: '' };
const DONE_SHOWN = 6;
const NAME_TIP = 'Plasticine 认技能用的名字：小写字母、数字和连字符。存了以后不能改。';

/** 左边：说一句，或者挑一件做成过的事。 */
function Tell({ busy, said, onSaid, onDraft }: { busy: boolean; said: string; onSaid: (text: string) => void;
  onDraft: (input: { said?: string; lineId?: string }) => void }): ReactNode {
  const live = useLive();
  const lines = useStore(live.lines.list).lines;
  const [lineId, setLineId] = useState<string | null>(null);
  const done = lines.filter((line) => line.kind === 'background' && line.outcome === 'done' && line.unmet == null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, DONE_SHOWN);
  return <div className="skills-tell">
    <label className="skills-tell-label" htmlFor="skill-said">想让 Plasticine 学会什么？</label>
    <textarea id="skill-said" className="field-input skills-said" maxLength={SKILL_SAID_MAX_CHARS} autoFocus
      value={said} onChange={(event) => onSaid(event.target.value)} />
    <button type="button" className="primary-button skills-tell-go" disabled={busy || said.trim() === ''}
      onClick={() => onDraft({ said: said.trim() })}>{busy && lineId === null ? '正在写…' : '写草稿'}</button>
    {done.length === 0 ? null : <>
      <h2 className="skills-tell-label">或者，从做成过的事里整理</h2>
      <ul className="skills-done" aria-label="做成过的事">
        {done.map((line) => <li key={line.id}>
          <button type="button" className="skills-done-row" aria-pressed={lineId === line.id}
            onClick={() => setLineId((current) => current === line.id ? null : line.id)}>
            <Icon name="check" size={14} />
            <span className="skills-done-title">{line.title}</span>
            <span className="skills-done-time">{relativeTime(line.updatedAt, new Date())}</span>
          </button>
        </li>)}
      </ul>
      <button type="button" className="secondary-button skills-tell-go" disabled={busy || lineId === null}
        onClick={() => { if (lineId !== null) { onDraft({ lineId, ...(said.trim() === '' ? {} : { said: said.trim() }) }); } }}>
        {busy && lineId !== null ? '正在整理…' : '把这件事的做法整理成技能'}</button>
    </>}
  </div>;
}

/** 右边：名字、短名、什么时候用、方法；保存、保存并试一次、不要了。 */
function Form({ draft, written, onChange, onSave, onDrop, busy, error }: { draft: SkillDraft; written: boolean;
  onChange: (draft: SkillDraft) => void; onSave: (tryIt: boolean) => void; onDrop: () => void; busy: boolean;
  error: string | null }): ReactNode {
  const [dropping, setDropping] = useState(false);
  const badName = draft.name !== '' && !SKILL_NAME_PATTERN.test(draft.name);
  const ready = SKILL_NAME_PATTERN.test(draft.name) && draft.description.trim() !== '' && draft.body.trim() !== '';
  const dirty = Object.values(draft).some((value) => value.trim() !== '');
  const set = (key: keyof SkillDraft) => (event: { target: { value: string } }): void =>
    onChange({ ...draft, [key]: event.target.value });
  return <form className="skills-form" aria-label="技能草稿" onSubmit={(event) => {
    event.preventDefault();
    if (ready && !busy) { onSave(false); }
  }}>
    <header className="skill-detail-head">
      <h2>草稿</h2>
      {written ? <span className="tag tag-neutral">Plasticine 写的，可以改</span> : null}
    </header>
    <div className="skills-form-pair">
      <label className="skills-field">
        <span className="field-label">名字</span>
        <input className="field-input" maxLength={SKILL_TITLE_MAX_CHARS} value={draft.title} onChange={set('title')} />
      </label>
      <div className="skills-field skills-field-name">
        <span className="field-label-row"><label className="field-label" htmlFor="skill-name">短名</label>
          <InfoTip label="短名的说明" text={NAME_TIP} /></span>
        <input id="skill-name" className="field-input field-input-mono" maxLength={64} autoCapitalize="off"
          spellCheck={false} aria-invalid={badName} value={draft.name} onChange={set('name')} />
      </div>
    </div>
    {badName ? <p className="skills-error" role="alert">短名只用小写字母、数字和连字符，比如 meeting-notes</p> : null}
    <label className="skills-field">
      <span className="field-label">什么时候用</span>
      <input className="field-input" maxLength={1024} value={draft.description} onChange={set('description')} />
    </label>
    <label className="skills-field skills-field-grow">
      <span className="field-label">方法</span>
      <textarea className="field-input skills-body" maxLength={SKILL_BODY_MAX_CHARS} value={draft.body}
        onChange={set('body')} />
    </label>
    {error === null ? null : <p className="skills-error" role="alert">{error}</p>}
    {dropping ? <div className="skill-confirm" role="alertdialog" aria-label="不要这份草稿">
      <span className="skill-confirm-text">草稿没存，丢了找不回来</span>
      <button type="button" className="text-button text-button-quiet" onClick={() => setDropping(false)}>接着写</button>
      <button type="button" className="primary-button button-small" onClick={onDrop}>不要了</button>
    </div> : <div className="skill-preview-actions">
      <button type="submit" className="primary-button" disabled={!ready || busy}>{busy ? '正在存…' : '保存'}</button>
      <button type="button" className="secondary-button" disabled={!ready || busy} onClick={() => onSave(true)}>
        保存并试一次</button>
      <button type="button" className="text-button text-button-quiet" disabled={busy}
        onClick={() => { if (dirty) { setDropping(true); } else { onDrop(); } }}>不要了</button>
    </div>}
  </form>;
}

export function SkillsNew({ phone, single, navigate, onBack, onSaved }: SkillsNewProps): ReactNode {
  const api = useApi();
  const { conversations } = useClientState();
  const [mode, setMode] = useState<Mode>('tell');
  // 说的那句放在这一层：一次只放一栏时回去重说，话还在。
  const [said, setSaid] = useState('');
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [written, setWritten] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = (input: { said?: string; lineId?: string }): void => {
    setDrafting(true);
    setError(null);
    api.skills.draft(input).then((result) => {
      setDrafting(false);
      setDraft(result);
      setWritten(true);
    }, (cause: unknown) => {
      setDrafting(false);
      setError(errorText(cause));
    });
  };
  const save = (tryIt: boolean): void => {
    if (draft === null) { return; }
    setSaving(true);
    setError(null);
    const title = draft.title.trim();
    api.skills.create({ requestId: createRequestId(), title, name: draft.name, description: draft.description.trim(),
      body: draft.body.trim() }).then((result) => {
      setSaving(false);
      if (!tryIt) { onSaved(result.skill); return; }
      conversations.forLine(MAIN_LINE_ALIAS).ui.setDraft(`用「${title === '' ? draft.name : title}」这个技能试一次：`);
      navigate(mainLineRoute());
    }, (cause: unknown) => {
      setSaving(false);
      setError(errorText(cause));
    });
  };
  const change = (next: Mode): void => {
    setMode(next);
    setError(null);
    setWritten(false);
    setDraft(next === 'write' ? EMPTY : null);
  };
  const form = draft === null ? null : <Form draft={draft} written={written} onChange={setDraft} onSave={save}
    onDrop={onBack} busy={saving} error={error} />;
  const formOnly = single && draft !== null;
  return <div className="skills-new" data-phone={phone} data-single={single} data-mode={mode}>
    {formOnly ? null : <section className="skills-new-ask" aria-label="新建技能">
      <header className="skills-pane-head">
        <IconButton icon="back" label="回到技能" onClick={onBack} />
        <h1>新建技能</h1>
      </header>
      <div className="segmented skills-kinds" role="group" aria-label="怎么新建">
        <button type="button" className="segmented-item" aria-pressed={mode === 'tell'}
          onClick={() => change('tell')}>说给 Plasticine</button>
        <button type="button" className="segmented-item" aria-pressed={mode === 'write'}
          onClick={() => change('write')}>自己写</button>
      </div>
      {mode === 'tell' ? <Tell busy={drafting} said={said} onSaid={setSaid} onDraft={ask} /> : null}
      {mode === 'tell' && error !== null && draft === null ? <p className="skills-error" role="alert">{error}</p>
        : null}
    </section>}
    {formOnly ? <section className="skills-new-ask" aria-label="新建技能">
      <header className="skills-pane-head">
        <IconButton icon="back" label={mode === 'tell' ? '回去重说' : '回上一步'} onClick={() => change('tell')} />
        <h1>新建技能</h1>
      </header>
      {form}
    </section> : single ? null : <div className="skills-new-form">
      {form ?? (mode === 'tell' ? <p className="block-empty">草稿会出现在这里</p> : null)}
    </div>}
  </div>;
}
