// 编辑弹框里的 Soul（第13批设计稿 Editor）：等宽字的一块，markdown 的「-」「## 」标成强调色（字下面垫一层同样排版的
// 影子，输入框本身的字是透明的）；下面一行写它自己最近一次改了几处，「看改动」就地展开一行行加的、删的，「撤回」
// 只在那一次之后没再改过、你也没改着没存时能点。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { SoulDiffLine, SoulRevision } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import type { SoulDoc } from './use-soul-doc.ts';
import './soul-field.css';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一行里的 markdown 记号：标题整行、列表的「- 」。 */
function MarkedLine({ line }: { line: string }): ReactNode {
  if (/^#{1,6}\s/u.test(line)) return <span className="soul-text-mark">{line}</span>;
  const item = /^(\s*[-*]\s)(.*)$/u.exec(line);
  if (item === null) return line;
  return <><span className="soul-text-mark">{item[1]}</span>{item[2]}</>;
}

function SoulText({ id, value, onChange, readOnly, placeholder }: { id: string; value: string;
  onChange: (text: string) => void; readOnly: boolean; placeholder?: string | undefined }): ReactNode {
  const mirror = useRef<HTMLDivElement>(null);
  const lines = value.split('\n');
  return (
    <div className="soul-text" data-readonly={readOnly}>
      <div ref={mirror} className="soul-text-mirror" aria-hidden="true">
        {lines.map((line, index) => <span key={index}>{index === 0 ? null : '\n'}<MarkedLine line={line} /></span>)}
        {/* 最后是空行时垫一个零宽字，让影子和输入框一样高。 */}
        {value.endsWith('\n') ? '\u200b' : null}
      </div>
      <textarea id={id} className="soul-text-input" value={value} spellCheck={false} readOnly={readOnly}
        placeholder={placeholder} onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (mirror.current !== null) mirror.current.scrollTop = event.currentTarget.scrollTop;
        }} />
    </div>
  );
}

/** 「昨晚」「3 天前」「10-27」：夜里整理的时间。 */
function whenOf(at: string, now: Date): string {
  return now.getTime() - new Date(at).getTime() < DAY_MS ? '昨晚' : relativeTime(at, now);
}

/** 接两段字：挨着数字的地方空一格（「已撤回 3 天前的改动」「10-27 整理时」）。 */
function joined(...parts: string[]): string {
  return parts.reduce((text, part) => text === '' ? part
    : /\d$/u.test(text) || /^\d/u.test(part) ? `${text} ${part}` : `${text}${part}`, '');
}

/** 改动前后各留几行没改的，再远的收成一行「没改的 n 行」。 */
const CONTEXT_LINES = 1;

type DiffRow = SoulDiffLine | { kind: 'skip'; count: number };

/** 只摆改了的地方和它前后一行；没改的长段收起来。 */
export function diffRows(diff: readonly SoulDiffLine[]): DiffRow[] {
  const near = diff.map((_, index) => diff.slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1)
    .some((line) => line.kind !== 'same'));
  const rows: DiffRow[] = [];
  diff.forEach((line, index) => {
    if (near[index] === true) {
      rows.push(line);
      return;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === 'skip') last.count += 1;
    else rows.push({ kind: 'skip', count: 1 });
  });
  return rows;
}

/** 看改动：这一次的一句说明 + 一行行加的、删的（编辑弹框和「昨晚整理」共用）。 */
export function DiffView({ owner, revision, note = true }: { owner: string; revision: SoulRevision;
  /** 那一句说明已经写在旁边了（昨晚整理）就不再写一遍。 */
  note?: boolean }): ReactNode {
  const api = useApi();
  const [diff, setDiff] = useState<SoulDiffLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api.souls.revision(owner, revision.id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setDiff(value.diff);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, owner, revision.id]);
  return (
    <div className="soul-diff" role="region" aria-label="这一次的改动">
      {!note || revision.note.trim() === '' ? null : <p className="soul-diff-note">{revision.note}</p>}
      {error !== null ? <p className="soul-diff-state is-error" role="alert">{error}</p>
        : diff === null ? <p className="soul-diff-state">正在读…</p> : (
          <ol className="soul-diff-lines">
            {diffRows(diff).map((line, index) => line.kind === 'skip' ? (
              <li key={index} className="soul-diff-line" data-kind="skip">
                <span className="soul-diff-sign" />
                <span className="soul-diff-text">⋯ 没改的 {line.count} 行</span>
              </li>
            ) : (
              <li key={index} className="soul-diff-line" data-kind={line.kind}>
                <span className="soul-diff-sign" aria-label={line.kind === 'add' ? '加了' : line.kind === 'remove'
                  ? '删了' : undefined}>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
                <span className="soul-diff-text">{line.text === '' ? '\u00a0' : line.text}</span>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

export function SoulField({ owner, doc, now = new Date(), placeholder }: { owner: string | null; doc: SoulDoc;
  now?: Date; placeholder?: string }): ReactNode {
  const [showing, setShowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const revisions = doc.base?.revisions ?? [];
  const self = revisions.find((revision) => revision.actor === 'self');
  const undoable = self !== undefined && self.undoneAt === null && revisions[0]?.id === self.id;
  const undo = async (revision: SoulRevision): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const failed = await doc.undo(revision.id);
    setBusy(false);
    setProblem(failed);
    if (failed === null) setShowing(false);
  };
  return (
    <div className="soul-field">
      <label className="soul-field-label" htmlFor="soul-text">Soul</label>
      {doc.error !== null ? <p className="soul-field-state is-error" role="alert">没有读到 Soul：{doc.error}</p> : (
        <SoulText id="soul-text" value={doc.text} onChange={doc.setText} readOnly={doc.loading}
          placeholder={doc.loading ? '正在读…' : placeholder} />
      )}
      {owner === null || doc.base === null ? null : (
        <div className="soul-field-meta">
          <span>{self === undefined ? '还没有自己改过' : self.undoneAt !== null
            ? joined('已撤回', whenOf(self.at, now), '的改动')
            : joined(whenOf(self.at, now), '整理时自己改了', ` ${self.changes} 处`)}</span>
          {self === undefined ? null : (
            <button type="button" className="soul-field-link" aria-expanded={showing}
              onClick={() => setShowing(!showing)}>{showing ? '收起改动' : '看改动'}</button>
          )}
          {self === undefined || !undoable ? null : (
            <button type="button" className="soul-field-link" disabled={busy || doc.dirty}
              title={doc.dirty ? '先保存或改回你刚改的，再撤回' : undefined} onClick={() => void undo(self)}>
              <Icon name="undo" size={12} />撤回
            </button>
          )}
        </div>
      )}
      {problem === null ? null : <p className="soul-field-state is-error" role="alert">{problem}</p>}
      {showing && owner !== null && self !== undefined ? <DiffView owner={owner} revision={self} /> : null}
    </div>
  );
}
