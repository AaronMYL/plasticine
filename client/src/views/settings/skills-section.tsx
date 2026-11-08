import { useEffect, useId, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SkillListResponse, SkillRow } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { SectionHead } from './section-head.tsx';
import { SkillReader } from './skill-reader.tsx';
import './skills.css';

const PAGE_SIZE = 20;
const SKILLS_NOTE = '技能是做事的方法。Plasticine 会按任务选用，也可以把反复有效的做法整理成新技能。'
  + '正在执行的任务继续使用原来的版本。';
const SOURCES = { builtin: '随应用提供', installed: '已安装', agent: 'Plasticine 整理' } as const;

/** 删一个技能：后果常显，点了才删（挪出目录留底，正在用它的线照旧用已经加载的那一版）。 */
function ConfirmRemove({ skill, onDone, onCancel }: { skill: SkillRow; onDone: () => void; onCancel: () => void })
  : ReactNode {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="settings-confirm skill-confirm" role="alertdialog" aria-label={`删「${skill.name}」`}>
      <span className="settings-confirm-text">删 <b>{skill.name}</b>？以后不再选用它；正在用它的线不受影响</span>
      {error === null ? null : <span className="connect-error" role="alert">{error}</span>}
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

export function SkillsSection(): ReactNode {
  const api = useApi();
  const id = useId();
  const [view, setView] = useState<SkillListResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [searching, setSearching] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void api.skills.list({ query, offset, limit: PAGE_SIZE }, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setView(result); }
    }).catch(() => { if (!controller.signal.aborted) { setError(true); } });
    return () => controller.abort();
  }, [api, query, offset, refresh]);
  const turn = (next: number): void => { setOffset(next); setSelected(null); setView(null); };
  return <section className="block" aria-labelledby="settings-skills">
    <SectionHead id="settings-skills" title="技能" tip={SKILLS_NOTE}>
      <span className="skills-gap" />
      {view === null || view.total === 0 ? null : <span className="skills-count">{view.total}</span>}
      <IconButton icon="search" label="找技能" aria-pressed={searching}
        onClick={() => setSearching((value) => !value)} />
    </SectionHead>
    {searching ? <form className="skill-search" onSubmit={(event) => {
      event.preventDefault(); setQuery(draft.trim()); turn(0); setRefresh((value) => value + 1);
    }}>
      <input id={id} className="field-input" type="search" aria-label="找技能" placeholder="找技能" autoFocus
        value={draft} onChange={(event) => setDraft(event.target.value)} />
    </form> : null}
    {error ? <p className="block-empty is-error" role="alert">读取技能失败，请刷新目录后再看。</p>
      : view === null ? <p className="block-empty">正在读取技能目录…</p>
      : view.skills.length === 0 ? <p className="block-empty">还没有匹配的技能。</p> : null}
    <ul className="skill-rows" aria-label="技能目录">
      {/* 11-04 重做悬停：技能名（英文短名）看不出做什么，说明是必要的，常显成名字下面一行小字。 */}
      {(view?.skills ?? []).map((skill) => <li key={skill.name} className="skill-row-item">
        <div className="skill-row">
          <span className="skill-row-main">
            <span className="skill-row-name">{skill.name}
              {skill.source.kind === 'agent' ? <AiMark label={SOURCES.agent} /> : null}</span>
            {skill.description === '' ? null : <span className="skill-row-desc">{skill.description}</span>}
          </span>
          {skill.uses === 0 ? null : <span className="skill-row-uses" title="Plasticine 用过几次">{skill.uses} 次</span>}
          {skill.source.kind === 'builtin' ? null : <IconButton icon="trash" label={`删「${skill.name}」`}
            onClick={() => setRemoving(skill.name)} />}
          <IconButton icon={selected === skill.name ? 'chevron-up' : 'eye'}
            label={selected === skill.name ? '收起方法' : `看「${skill.name}」的方法`}
            aria-expanded={selected === skill.name}
            onClick={() => setSelected((current) => current === skill.name ? null : skill.name)} />
        </div>
        {removing === skill.name ? <ConfirmRemove skill={skill} onCancel={() => setRemoving(null)} onDone={() => {
          setRemoving(null);
          setRefresh((value) => value + 1);
        }} /> : null}
        {selected === skill.name ? <SkillReader key={`${skill.name}:${skill.version}`} descriptor={skill} /> : null}
      </li>)}
    </ul>
    {(view?.issues ?? []).length > 0 ? <details className="tool-group-details">
      <summary>有 {view!.issues.length} 份技能暂未载入</summary>
      {view!.issues.map((issue) => <p key={issue.name} className="text-meta">{issue.name}：{issue.reason}</p>)}
    </details> : null}
    {view !== null && (offset > 0 || view.nextOffset !== null) ? <div className="tool-bar">
      <button type="button" className="text-button" disabled={offset === 0}
        onClick={() => turn(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
      <span className="text-meta">{offset + 1}–{offset + view.skills.length} / {view.total}</span>
      <button type="button" className="text-button" disabled={view.nextOffset === null}
        onClick={() => turn(view.nextOffset ?? offset)}>下一页</button>
    </div> : null}
  </section>;
}
