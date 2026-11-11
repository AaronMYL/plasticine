// 记忆「规则」的一行和它的详情（11-11 第二步设计稿 M2 / M4）：一行 = 文字 · 只对哪位队友 · 来源 · 日子；
// 点开看来源原话、改适用范围、为什么以它为准、改和删。电脑上在右边一栏，手机上是底部弹层（外面套）。

import { useState, type ReactNode } from 'react';
import { SOUL_SECTIONS, SOUL_SECTION_LABELS, type MateView, type SoulChange, type SoulLine,
  type SoulSection } from '../../api/shared.ts';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { mainLineRoute, routeHash } from '../../shell/routes.ts';
import { MateAvatar } from '../mates/mate-avatar.tsx';

export const RULE_SOURCE_LABELS: Readonly<Record<SoulLine['source'], string>> = {
  user: '你说的', conversation: '你说的', inference: '你确认过', mate: '队友设定', system: '系统默认',
};

export function ruleDay(at: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at))
    .replace('/', '-');
}

export function ruleMate(line: SoulLine, mates: readonly MateView[]): MateView | undefined {
  return line.scopeKind === 'mate' ? mates.find((mate) => mate.id === line.scopeRef) : undefined;
}

export function ScopeChip({ line, mates }: { line: SoulLine; mates: readonly MateView[] }): ReactNode {
  if (line.scopeKind !== 'mate') return null;
  const mate = ruleMate(line, mates);
  return <span className="rule-chip">{mate === undefined ? null : <MateAvatar mate={mate} size={14} />}
    只对{mate?.name ?? '一位队友'}</span>;
}

export function RuleRow({ line, mates, selected, conflict, onOpen }: { line: SoulLine; mates: readonly MateView[];
  selected: boolean; conflict: boolean; onOpen: () => void }): ReactNode {
  return <li className="rule-row" data-selected={selected}>
    <button type="button" className="rule-row-main" aria-pressed={selected} onClick={onOpen}>
      <span className="rule-bullet" aria-hidden="true">·</span>
      <span className="rule-text">{line.text}</span>
      {conflict ? <span className="rule-conflict" role="img" aria-label="和另一条说法冲突">
        <Icon name="alert" size={14} /></span> : null}
      <ScopeChip line={line} mates={mates} />
      <span className="rule-meta">{RULE_SOURCE_LABELS[line.source]}</span>
      <time className="rule-meta rule-day" dateTime={line.at}>{ruleDay(line.at)}</time>
    </button>
  </li>;
}

export function RuleEditor({ line, busy, onSave, onCancel }: { line: SoulLine | null; busy: boolean;
  onSave: (text: string, section: SoulSection) => void; onCancel: () => void }): ReactNode {
  const [text, setText] = useState(line?.text ?? '');
  const [section, setSection] = useState<SoulSection>(line?.section ?? 'doing');
  return <form className="rule-editor" onSubmit={(event) => { event.preventDefault(); onSave(text.trim(), section); }}>
    <textarea aria-label="规则内容" autoFocus value={text} maxLength={500} rows={3} disabled={busy}
      onChange={(event) => setText(event.target.value)} />
    <div className="rule-editor-actions">
      <div className="segmented" role="group" aria-label="归在哪一节">
        {SOUL_SECTIONS.map((key) => <button key={key} type="button" className="segmented-item"
          aria-pressed={section === key} disabled={busy} onClick={() => setSection(key)}>
          {SOUL_SECTION_LABELS[key]}</button>)}
      </div>
      <button type="button" className="secondary-button button-small" disabled={busy} onClick={onCancel}>取消</button>
      <button type="submit" className="primary-button button-small" disabled={busy || text.trim() === ''}>保存</button>
    </div>
  </form>;
}

/** 为什么以这条为准（一句）：只对队友的比共用的优先；你说的比推断、系统默认优先。 */
function priorityText(line: SoulLine, mate: MateView | undefined): string {
  if (line.scopeKind === 'mate') return `${mate?.name ?? '这位队友'}做事时，这条比所有队友共用的规则优先。`;
  if (line.source === 'system') return '系统默认：你说的规则和它冲突时，以你说的为准。';
  return '所有队友共用；和只对某位队友的规则冲突时，以那一条为准。';
}

export interface RuleDetailProps {
  line: SoulLine;
  mates: readonly MateView[];
  history: readonly SoulChange[];
  busy: boolean;
  onClose: () => void;
  onEdit: (text: string, section: SoulSection) => void;
  onScope: (mateId: string | null) => void;
  onDelete: () => void;
  /** 手机弹层自带关闭，这里不再画。 */
  inSheet?: boolean;
}

export function RuleDetail(props: RuleDetailProps): ReactNode {
  const { line, mates, busy } = props;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mate = ruleMate(line, mates);
  const quote = line.sources.find((item) => item.kind !== 'system');
  const href = quote?.kind === 'message' ? routeHash(mainLineRoute(quote.id))
    : quote?.kind === 'note' ? `#/notes/${encodeURIComponent(quote.id)}`
      : quote?.kind === 'agreement' ? `#/memory/agreements/${encodeURIComponent(quote.id)}`
        : quote?.kind === 'book' ? `#/books/${encodeURIComponent(quote.id)}` : null;
  const changes = props.history.filter((change) => change.lineId === line.id);
  return <div className="rule-detail" data-sheet={props.inSheet === true}>
    <div className="rule-detail-head">
      {editing ? <RuleEditor line={line} busy={busy} onCancel={() => setEditing(false)}
        onSave={(text, section) => { props.onEdit(text, section); setEditing(false); }} />
        : <p className="rule-detail-text">{line.text}</p>}
      {props.inSheet === true ? null : <button type="button" className="icon-button" aria-label="关掉这一条"
        onClick={props.onClose}><Icon name="close" size={16} /></button>}
    </div>
    <section aria-label="来源"><h3 className="rule-label">来源</h3>
      <div className="rule-source">{quote === undefined ? null : <p>「{quote.label}」</p>}
        <p className="rule-meta">{RULE_SOURCE_LABELS[line.source]} · {ruleDay(line.at)}
          {href === null ? null : <> · <a href={href}>打开</a></>}</p></div>
    </section>
    <section aria-label="适用范围"><h3 className="rule-label">适用范围</h3>
      <select className="rule-scope" aria-label="适用范围" value={line.scopeKind === 'mate' ? line.scopeRef ?? '' : ''}
        disabled={busy} onChange={(event) => props.onScope(event.target.value === '' ? null : event.target.value)}>
        <option value="">所有队友共用</option>
        {mates.filter((item) => item.disabledAt === null || item.id === mate?.id).map((item) => (
          <option key={item.id} value={item.id}>只对{item.name}</option>))}
      </select>
    </section>
    <section aria-label="优先级"><h3 className="rule-label">优先级</h3><p>{priorityText(line, mate)}</p></section>
    {changes.length === 0 ? null : <section aria-label="改动"><h3 className="rule-label">改动</h3>
      <ul className="rule-changes">{changes.slice(0, 5).map((change) => <li key={change.id}>
        <time dateTime={change.at}>{ruleDay(change.at)}</time> {change.actor === 'user' ? '你' : 'Plasticine'}
        {CHANGE_LABELS[change.action]}</li>)}</ul></section>}
    <div className="rule-detail-actions">
      <button type="button" className="secondary-button button-small" disabled={busy || editing}
        onClick={() => setEditing(true)}><Icon name="edit" size={14} />修改</button>
      <button type="button" className="secondary-button button-small rule-delete" disabled={busy}
        onClick={() => setDeleting(true)}><Icon name="trash" size={14} />删除</button>
    </div>
    {deleting ? <ConfirmDialog title="删除这条规则？" body="删掉后 Plasticine 不再照它做；改动记录里还看得到。"
      confirmLabel="删除" busy={busy} onCancel={() => setDeleting(false)}
      onConfirm={() => { props.onDelete(); setDeleting(false); }} /> : null}
  </div>;
}

const CHANGE_LABELS: Readonly<Record<SoulChange['action'], string>> = {
  add: '加了这条', edit: '改了说法', move: '换了一节', undo: '删了这条', scope: '改了适用范围',
};
