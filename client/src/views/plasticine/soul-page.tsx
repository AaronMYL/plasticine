import { useState, type ReactNode } from 'react';
import { SOUL_SECTIONS, SOUL_SECTION_LABELS, type SoulLine } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { SoulEditor, SoulRule, soulDay } from './soul-rules.tsx';
import { useSoul } from './use-soul.ts';
import { MateSoul } from './mate-soul.tsx';
import './soul.css';

const ACTIONS = { add: '新增', edit: '改写', move: '移动', undo: '撤销' };
export interface SoulPageProps { mateId?: string }

export function SoulPage({ mateId }: SoulPageProps): ReactNode {
  const soul = useSoul();
  const [editing, setEditing] = useState<SoulLine | 'new' | null>(null);
  const [history, setHistory] = useState(false);
  const busy = soul.operation !== undefined && soul.operation.status !== 'failed';
  const value = soul.value;
  const editor = editing === null ? null : <SoulEditor key={editing === 'new' ? 'new' : editing.id}
    line={editing === 'new' ? null : editing} busy={busy} onCancel={() => setEditing(null)}
    onSave={(text, section) => {
      void soul.change(editing === 'new' ? { action: 'add', text, section } : { action: 'edit',
        id: editing.id, version: editing.version, text, section }).then((done) => { if (done) setEditing(null); });
    }} />;
  return <div className="soul-page">
    <div className="soul-main">
      <header className="soul-head">
        <span className="soul-main-avatar"><PlasticineMark size={22} /></span>
        <div><h1>主线的 Soul</h1><p>所有队友共用</p></div>
        <button type="button" className="chip-button soul-history-button" aria-expanded={history}
          onClick={() => setHistory((open) => !open)}><Icon name="history" size={15} />改动记录</button>
      </header>
      {soul.error === null ? null : <p role="alert">{soul.error}
        <button type="button" className="text-button" onClick={soul.reload}>重试</button></p>}
      {soul.operation?.error == null ? null : <div className="soul-error" role="alert">
        <span>{soul.operation.error}</span>
        {soul.operation.status === 'failed' ? <button className="text-button" onClick={soul.reload}>刷新</button>
          : <button className="text-button" onClick={() => void soul.retry().then((done) => {
            if (done) setEditing(null);
          })}>{soul.operation.status === 'uncertain' ? '再核实' : '重发'}</button>}
      </div>}
      {history && value !== null ? <section className="soul-history" aria-label="改动记录">
        <h2>改动记录</h2>
        {value.history.length === 0 ? <p className="text-meta">还没有改动</p> : <ol>{value.history.map((change) => (
          <li key={change.id}><span>{ACTIONS[change.action]} · {change.text}</span>
            <time dateTime={change.at}>{soulDay(change.at)}</time></li>
        ))}</ol>}
      </section> : null}
      {value === null ? <p className="text-meta" role="status">正在读取</p> : SOUL_SECTIONS.map((section) => (
        <section className="soul-section" key={section} aria-labelledby={`soul-${section}`}>
          <h2 id={`soul-${section}`}>{SOUL_SECTION_LABELS[section]}</h2>
          <ul>{value.lines.filter((line) => line.section === section).map((line) => editing !== 'new'
            && editing?.id === line.id ? <li key={line.id}>{editor}</li> : <SoulRule key={line.id} line={line}
              busy={busy} onEdit={() => setEditing(line)} onUndo={() => {
                void soul.change({ action: 'undo', id: line.id, version: line.version });
              }} />)}</ul>
        </section>
      ))}
      {editing === 'new' ? editor : <button type="button" className="soul-add" disabled={busy}
        onClick={() => setEditing('new')}><Icon name="plus" size={14} />加一条</button>}
    </div>
    <MateSoul {...(mateId === undefined ? {} : { mateId })} lines={value?.lines ?? []} />
  </div>;
}
