import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { SkillRow } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { routeHash, skillsRoute, type Route } from '../../shell/routes.ts';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { SkillDetail } from './skill-detail.tsx';
import { SOURCE_LABELS, skillLabel, type SkillKind } from './skill-text.ts';
import { SkillsAdd } from './skills-add.tsx';
import { SkillsNew } from './skills-new.tsx';
import { useNarrow } from './use-narrow.ts';
import { useSkills, type SkillsData } from './use-skills.ts';
import './skills.css';
import { SearchField } from '../../primitives/search-field/index.tsx';

export interface SkillsPageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
  onBack?: (() => void) | undefined;
}

const KINDS: readonly SkillKind[] = ['builtin', 'installed', 'agent'];

function Row({ skill, current, navigate }: { skill: SkillRow; current: boolean; navigate: (route: Route) => void })
  : ReactNode {
  const route = skillsRoute({ name: skill.name });
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) { return; }
    event.preventDefault();
    navigate(route);
  };
  return <li>
    <a className="skill-card" href={routeHash(route)} aria-current={current ? 'page' : undefined} onClick={open}>
      <span className="skill-card-head">
        <span className="skill-card-name">{skillLabel(skill)}</span>
        <span className="tag tag-neutral">{SOURCE_LABELS[skill.source.kind]}</span>
      </span>
      {skill.description === '' ? null : <span className="skill-card-desc">{skill.description}</span>}
      {skill.uses === 0 ? null : <span className="skill-card-uses">用过 {skill.uses} 次</span>}
    </a>
  </li>;
}

function Actions({ navigate, phone }: { navigate: (route: Route) => void; phone: boolean }): ReactNode {
  if (phone) {
    return <>
      <IconButton icon="plus" size={20} label="添加技能" onClick={() => navigate(skillsRoute({ pane: 'add' }))} />
      <IconButton icon="edit" size={20} label="新建技能" onClick={() => navigate(skillsRoute({ pane: 'new' }))} />
    </>;
  }
  return <>
    <button type="button" className="secondary-button button-small"
      onClick={() => navigate(skillsRoute({ pane: 'add' }))}>
      <Icon name="plus" size={14} />添加</button>
    <button type="button" className="secondary-button button-small"
      onClick={() => navigate(skillsRoute({ pane: 'new' }))}>
      <Icon name="edit" size={14} />新建</button>
  </>;
}

function List({ data, selected, phone, navigate }: { data: SkillsData; selected: string | null; phone: boolean;
  navigate: (route: Route) => void }): ReactNode {
  const [kind, setKind] = useState<SkillKind | 'all'>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const all = data.skills ?? [];
  const present = KINDS.filter((item) => all.some((skill) => skill.source.kind === item));
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return all.filter((skill) => (kind === 'all' || skill.source.kind === kind)
      && (words === '' || `${skill.name} ${skill.title ?? ''} ${skill.description}`.toLowerCase().includes(words)));
  }, [all, kind, query]);
  const nothing = shown.length === 0
    ? <p className="block-empty">{all.length === 0 ? '还没有技能' : '没有匹配的技能'}</p> : null;
  return <section className="skills-list" aria-label="技能目录">
    {phone ? <PageHeader title="技能" phoneSearch={false} phoneTools={<>
      <IconButton icon="search" size={20} label="找技能" aria-pressed={searching}
        onClick={() => setSearching((value) => !value)} />
      <Actions navigate={navigate} phone />
    </>} /> : <header className="skills-list-head">
      <h1>技能</h1>
      <IconButton icon="search" label="找技能" aria-pressed={searching}
        onClick={() => setSearching((value) => !value)} />
      <Actions navigate={navigate} phone={false} />
    </header>}
    {searching ? <SearchField className="skills-search" label="找技能" autoFocus value={query} onChange={setQuery} />
      : null}
    {present.length < 2 ? null : <div className="segmented skills-kinds" role="group" aria-label="来源">
      <button type="button" className="segmented-item" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
        全部 {all.length}</button>
      {present.map((item) => <button key={item} type="button" className="segmented-item"
        aria-pressed={kind === item} onClick={() => setKind(item)}>
        {SOURCE_LABELS[item]} {all.filter((skill) => skill.source.kind === item).length}</button>)}
    </div>}
    {data.error ? <p className="block-empty is-error" role="alert">技能没读出来。{' '}
      <button type="button" className="text-button" onClick={data.reload}>再读一次</button></p>
      : data.skills === null ? <PageLoading rows={3} dense /> : nothing}
    <ul className="skill-cards">
      {shown.map((skill) => <Row key={skill.name} skill={skill} current={selected === skill.name}
        navigate={navigate} />)}
    </ul>
    {data.issues.length === 0 ? null : <details className="skills-fold">
      <summary>{data.issues.length} 份技能暂未载入</summary>
      {data.issues.map((issue) => <p key={issue.name} className="text-meta">{issue.name}：{issue.reason}</p>)}
    </details>}
  </section>;
}

function Missing({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  return <div className="skill-detail"><p className="block-empty">这个技能不在了。{' '}
    <button type="button" className="text-button" onClick={() => navigate(skillsRoute())}>回到技能</button></p></div>;
}

const SINGLE_BELOW = 640;

export function SkillsPage({ route, phone, navigate, onBack }: SkillsPageProps): ReactNode {
  const data = useSkills();
  const [root, narrow] = useNarrow<HTMLDivElement>(SINGLE_BELOW);
  const single = phone || narrow;
  const toList = (): void => navigate(skillsRoute());
  const saved = (skill: SkillRow): void => {
    data.reload();
    navigate(skillsRoute({ name: skill.name }));
  };
  const name = route.skillName ?? null;
  const skill = data.skills === null ? null
    : data.skills.find((item) => item.name === name) ?? (name === null && !single ? data.skills[0] ?? null : null);
  const removed = (): void => {
    data.reload();
    toList();
  };
  const detailOf = (): ReactNode => {
    if (data.skills === null) {
      if (data.error) return <p className="block-empty is-error" role="alert">技能没读出来。</p>;
      return single ? <PageLoading rows={3} dense /> : null;
    }
    if (skill !== null) return <SkillDetail key={skill.name} skill={skill} onRemoved={removed} />;
    return name !== null ? <Missing navigate={navigate} /> : null;
  };
  const detail = detailOf();
  const body = (): ReactNode => {
    if (route.skillsPane === 'add') {
      return <SkillsAdd phone={phone} single={single} onBack={toList} onSaved={saved} onChanged={data.reload}
        onOpen={(picked) => navigate(skillsRoute({ name: picked }))} />;
    }
    if (route.skillsPane === 'new') {
      return <SkillsNew phone={phone} single={single} navigate={navigate} onBack={toList} onSaved={saved} />;
    }
    if (phone && name !== null) {
      return <div className="page skills-phone">
        <PageHeader title="技能" phoneSearch={false} onBack={onBack ?? toList} />
        {detail}
      </div>;
    }
    if (phone) {
      return <div className="page skills-phone"><List data={data} selected={null} phone navigate={navigate} /></div>;
    }
    if (single && name !== null) {
      return <div className="skills-page"><div className="skills-main">
        <header className="skills-pane-head skills-main-head">
          <IconButton icon="back" label="回到技能" onClick={toList} />
          <h1>技能</h1>
        </header>
        {detail}
      </div></div>;
    }
    return <div className="skills-page">
      <List data={data} selected={skill?.name ?? null} phone={false} navigate={navigate} />
      {single ? null : <div className="skills-main">{detail}</div>}
    </div>;
  };
  return <div ref={root} className="skills-root" data-single={single}>{body()}</div>;
}
