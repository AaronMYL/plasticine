import { useState, type ReactNode } from 'react';
import { SOUL_SECTIONS, SOUL_SECTION_LABELS, type SoulLine, type SoulSection } from '../../api/shared.ts';
import { mainLineRoute, routeHash } from '../../shell/routes.ts';
import { Icon } from '../../shell/icons.tsx';

export const SOUL_SOURCE_LABELS = {
  system: '系统默认', user: '你改的', conversation: '从对话里记下', inference: '你确认过的推断',
};
export function soulDay(at: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export function SoulSource({ line }: { line: SoulLine }): ReactNode {
  const source = line.sources.find((item) => item.kind === 'message' || item.kind === 'note');
  const label = SOUL_SOURCE_LABELS[line.source];
  const href = source?.kind === 'message' ? routeHash(mainLineRoute(source.id))
    : source?.kind === 'note' ? `#/notes/${encodeURIComponent(source.id)}` : null;
  return <span className="soul-source"><time dateTime={line.at}>{soulDay(line.at)}</time>
    {href !== null && (line.source === 'conversation' || line.source === 'inference')
      ? <a href={href}>{label}</a> : <span>{label}</span>}</span>;
}

export function SoulEditor({ line, busy, onSave, onCancel }: { line: SoulLine | null; busy: boolean;
  onSave: (text: string, section: SoulSection) => void; onCancel: () => void }): ReactNode {
  const [text, setText] = useState(line?.text ?? '');
  const [section, setSection] = useState<SoulSection>(line?.section ?? 'doing');
  return <form className="soul-editor" onSubmit={(event) => { event.preventDefault(); onSave(text.trim(), section); }}>
    <textarea aria-label="规则内容" autoFocus value={text} maxLength={500} rows={3} disabled={busy}
      onChange={(event) => setText(event.target.value)} />
    <div className="soul-editor-actions">
      <select aria-label="所属小节" value={section} disabled={busy}
        onChange={(event) => setSection(event.target.value as SoulSection)}>
        {SOUL_SECTIONS.map((key) => <option key={key} value={key}>{SOUL_SECTION_LABELS[key]}</option>)}
      </select>
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="submit" className="chip-button" aria-label="保存规则" disabled={busy || text.trim() === ''}>保存</button>
    </div>
  </form>;
}

export function SoulRule({ line, busy, onEdit, onUndo }: { line: SoulLine; busy: boolean;
  onEdit: () => void; onUndo: () => void }): ReactNode {
  const generated = line.source === 'conversation' || line.source === 'inference';
  return <li className="soul-rule" aria-label={line.text}>
    <span className="soul-bullet" aria-hidden="true">{generated ? <Icon name="sparkle" size={13} /> : '·'}</span>
    <button className="soul-rule-text" type="button" aria-label={`编辑：${line.text}`} disabled={busy}
      onClick={onEdit}>{line.text}</button>
    <span className="soul-rule-meta"><SoulSource line={line} />
      <button type="button" className="text-button" disabled={busy} onClick={onUndo}>撤销</button>
    </span>
  </li>;
}
