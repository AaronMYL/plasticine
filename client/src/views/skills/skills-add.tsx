// 添加技能：商店（公开仓库里的一份清单）、从网址（GitHub 上的一个技能目录，或一份 SKILL.md）、从文件（一个技能文件夹）。
// 三种都是先看再装：点一张卡 / 填了网址 / 挑了文件，右边（手机上换一页）出这个技能让 Plasticine 怎么做。

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { SKILL_UPLOAD_MAX_FILES, type SkillOrigin, type SkillPreview, type SkillRow, type StoreSkillView }
  from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { SkillPreviewPane } from './skill-preview.tsx';

export interface SkillsAddProps {
  phone: boolean;
  /** 一次只放一栏（手机，或电脑上主区窄）：先看时不画清单。 */
  single: boolean;
  onBack: () => void;
  /** 从网址、文件装好：去看那个技能。 */
  onSaved: (skill: SkillRow) => void;
  /** 商店里装好：留在商店，目录要重读。 */
  onChanged: () => void;
  /** 商店里装好以后「去看看」。 */
  onOpen: (name: string) => void;
}

type Tab = 'store' | 'url' | 'files';
const TABS: ReadonlyArray<[Tab, string]> = [['store', '商店'], ['url', '从网址'], ['files', '从文件']];
const SOURCES = { official: '官方', community: '社区' } as const;
interface Shown { from: SkillOrigin; preview: SkillPreview; entry?: StoreSkillView }

function StoreCard({ skill, on, onPick }: { skill: StoreSkillView; on: boolean; onPick: () => void }): ReactNode {
  return <li>
    <button type="button" className="store-card" aria-pressed={on} onClick={onPick}>
      <span className="store-card-title">{skill.title}</span>
      <span className="store-card-desc">{skill.description}</span>
      <span className="store-card-foot">
        <span className="tag tag-neutral">{SOURCES[skill.source]}</span>
        {skill.scripts ? <span className="tag tag-outline-quiet">带脚本</span> : null}
        {skill.installed ? <span className="tag tag-outline">已装</span> : null}
      </span>
    </button>
  </li>;
}

function Store({ picked, onPick, turn }: { picked: string | null; onPick: (skill: StoreSkillView) => void;
  turn: number }): ReactNode {
  const api = useApi();
  const [skills, setSkills] = useState<StoreSkillView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api.skills.store(controller.signal).then((result) => {
      if (!controller.signal.aborted) { setSkills(result.skills); }
    }, (cause: unknown) => { if (!controller.signal.aborted) { setError(errorText(cause)); } });
    return () => controller.abort();
  }, [api, retry, turn]);
  const categories = useMemo(() => [...new Set((skills ?? []).map((skill) => skill.category))], [skills]);
  const shown = (skills ?? []).filter((skill) => (category === null || skill.category === category)
    && `${skill.title} ${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (error !== null) {
    return <p className="block-empty is-error" role="alert">{error}{' '}
      <button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>再试一次</button></p>;
  }
  if (skills === null) { return <PageLoading rows={3} dense />; }
  return <>
    <input className="field-input" type="search" aria-label="找技能" placeholder="找技能" value={query}
      onChange={(event) => setQuery(event.target.value)} />
    {categories.length < 2 ? null : <div className="store-cats" role="group" aria-label="分类">
      <button type="button" className="chip-button" aria-pressed={category === null}
        onClick={() => setCategory(null)}>全部</button>
      {categories.map((item) => <button key={item} type="button" className="chip-button"
        aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
    </div>}
    {shown.length === 0 ? <p className="block-empty">没有匹配的技能</p> : null}
    <ul className="store-grid" aria-label="商店里的技能">
      {shown.map((skill) => <StoreCard key={skill.name} skill={skill} on={picked === skill.name}
        onPick={() => onPick(skill)} />)}
    </ul>
  </>;
}

function FromUrl({ busy, onLook }: { busy: boolean; onLook: (url: string) => void }): ReactNode {
  const [url, setUrl] = useState('');
  return <form className="skills-from" onSubmit={(event) => {
    event.preventDefault();
    if (url.trim() !== '') { onLook(url.trim()); }
  }}>
    <label className="field-label" htmlFor="skill-url">技能的网址</label>
    <input id="skill-url" className="field-input field-input-mono" type="url" inputMode="url" autoFocus
      placeholder="https://github.com/…/tree/main/…" value={url} onChange={(event) => setUrl(event.target.value)} />
    <p className="field-hint">GitHub 上的一个技能目录，或者直接指到一份 SKILL.md</p>
    <button type="submit" className="primary-button" disabled={busy || url.trim() === ''}>
      {busy ? '正在读…' : '先看看'}</button>
  </form>;
}

function FromFiles({ busy, onLook, onError }: { busy: boolean;
  onLook: (files: Array<{ path: string; content: string }>) => void; onError: (message: string) => void }): ReactNode {
  const folder = useRef<HTMLInputElement>(null);
  const loose = useRef<HTMLInputElement>(null);
  const read = (input: HTMLInputElement): void => {
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (picked.length === 0) { return; }
    if (picked.length > SKILL_UPLOAD_MAX_FILES) {
      onError(`一个技能最多 ${SKILL_UPLOAD_MAX_FILES} 个文件，这里有 ${picked.length} 个。`);
      return;
    }
    Promise.all(picked.map(async (file) => ({ path: file.webkitRelativePath === '' ? file.name : file.webkitRelativePath,
      content: await file.text() }))).then(onLook, () => onError('文件没读出来，再挑一次。'));
  };
  return <div className="skills-from">
    <p className="skills-from-lead">挑一个技能文件夹（里面有 SKILL.md）</p>
    <div className="skill-preview-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => folder.current?.click()}>
        {busy ? '正在读…' : '选文件夹'}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => loose.current?.click()}>
        选文件</button>
    </div>
    <input ref={folder} type="file" hidden aria-label="选技能文件夹" multiple
      {...{ webkitdirectory: '' }} onChange={(event) => read(event.currentTarget)} />
    <input ref={loose} type="file" hidden aria-label="选技能文件" multiple
      onChange={(event) => read(event.currentTarget)} />
  </div>;
}

export function SkillsAdd({ phone, single, onBack, onSaved, onChanged, onOpen }: SkillsAddProps): ReactNode {
  const api = useApi();
  const [tab, setTab] = useState<Tab>('store');
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const asked = useRef(0);
  const look = (from: SkillOrigin, entry?: StoreSkillView): void => {
    asked.current += 1;
    const mine = asked.current;
    setBusy(true);
    setError(null);
    api.skills.preview(from).then((preview) => {
      if (mine !== asked.current) { return; }
      setBusy(false);
      setShown({ from, preview, ...(entry === undefined ? {} : { entry }) });
    }, (cause: unknown) => {
      if (mine !== asked.current) { return; }
      setBusy(false);
      setShown(null);
      setError(errorText(cause));
    });
  };
  const change = (next: Tab): void => {
    asked.current += 1;
    setTab(next);
    setShown(null);
    setBusy(false);
    setError(null);
  };
  const pane = shown === null ? null : <SkillPreviewPane key={`${shown.preview.name}:${tab}`} from={shown.from}
    preview={shown.preview} badge={shown.entry === undefined ? undefined : SOURCES[shown.entry.source]}
    updatedAt={shown.entry?.updatedAt} onOpen={tab === 'store' ? onOpen : undefined}
    onInstalled={(skill) => {
      if (tab !== 'store') { onSaved(skill); return; }
      onChanged();
      setTurn((value) => value + 1);
    }} />;
  // 一次只放一栏时：看一个技能就不画清单。
  const previewOnly = single && shown !== null;
  return <div className="skills-add" data-phone={phone} data-single={single}>
    <section className="skills-add-main" aria-label="添加技能">
      <header className="skills-pane-head">
        <IconButton icon="back" label={previewOnly ? '回到清单' : '回到技能'}
          onClick={previewOnly ? () => setShown(null) : onBack} />
        <h1>添加技能</h1>
        {previewOnly ? null : <div className="segmented" role="group" aria-label="从哪添加">
          {TABS.map(([value, label]) => <button key={value} type="button" className="segmented-item"
            aria-pressed={tab === value} onClick={() => change(value)}>{label}</button>)}
        </div>}
      </header>
      {previewOnly ? pane : <>
        {tab === 'store' ? <Store picked={shown?.preview.name ?? null} turn={turn}
          onPick={(skill) => look({ kind: 'store', name: skill.name }, skill)} /> : null}
        {tab === 'url' ? <FromUrl busy={busy} onLook={(url) => look({ kind: 'url', url })} /> : null}
        {tab === 'files' ? <FromFiles busy={busy} onError={setError}
          onLook={(files) => look({ kind: 'files', files })} /> : null}
        {error === null ? null : <p className="skills-error" role="alert">{error}</p>}
      </>}
    </section>
    {single ? null : pane}
  </div>;
}
