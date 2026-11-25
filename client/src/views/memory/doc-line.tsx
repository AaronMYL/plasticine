import { useContext, useState, type ReactNode } from 'react';
import type { MemoryDocLine, MemoryLineSource } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { PanelContext } from '../../shell/panel.ts';
import { mainLineRoute, messagesRoute, type Route } from '../../shell/routes.ts';
import { timeText } from '../../shell/time-text.ts';
import { LineEditor } from './line-actions.tsx';
import { useMemoryEdits } from './use-memory-edits.ts';

const BASIS_TAG: Readonly<Record<MemoryDocLine['basis'], string | null>> = {
  quote: null,
  system: '系统默认',
  agreement: null,
  inferred: '推断',
  contact: null,
  tried: null,
};

export type LineLook = 'doc' | 'how' | 'row';

export function sourceRoute(source: MemoryLineSource): Route | null {
  switch (source.kind) {
    case 'system': return { view: 'memory', noteId: null };
    case 'agreement': return null;
    case 'message': return mainLineRoute(source.id);
    case 'note': return { view: 'notes', noteId: source.id };
    case 'book': return { view: 'books', noteId: null, bookId: source.id };
    case 'contact': return messagesRoute(source.id);
    case 'work': return null;
  }
}

export function useOpenSource(navigate: (route: Route) => void): (source: MemoryLineSource) => void {
  const openPanel = useContext(PanelContext);
  return (source) => {
    const route = sourceRoute(source);
    if (route === null) {
      openPanel?.({ kind: 'work', lineId: source.id });
    } else {
      navigate(route);
    }
  };
}

function LineText({ line, navigate }: { line: MemoryDocLine; navigate: (route: Route) => void }): ReactNode {
  const links = new Map((line.links ?? []).map((link) => [link.name, link.topicId]));
  const parts = line.text.split(/(\[\[[^[\]\n]{1,60}\]\])/);
  return parts.map((part, index) => {
    const name = /^\[\[(.+)\]\]$/.exec(part)?.[1]?.trim();
    if (name === undefined) {
      return part;
    }
    const topicId = links.get(name) ?? null;
    return topicId === null ? <span key={index}>{name}</span> : (
      <button key={index} type="button" className="doc-link"
        onClick={() => navigate({ view: 'memory', noteId: null, topicId })}>{name}</button>
    );
  });
}

function SourceLink({ source, open }: { source: MemoryLineSource; open: (source: MemoryLineSource) => void }):
  ReactNode {
  return (
    <button type="button" className="text-button text-button-quiet doc-line-source"
      aria-label={`回到原话：${source.label}`} onClick={() => open(source)}>
      {source.label} ›
    </button>
  );
}

export interface DocLineProps {
  line: MemoryDocLine;
  docId: string;
  navigate: (route: Route) => void;
  look?: LineLook;
  now?: Date;
  actions?: (edit: () => void) => ReactNode;
  lead?: ReactNode;
}

export function DocLine({ line, docId, navigate, look = 'doc', now = new Date(), actions, lead }: DocLineProps):
  ReactNode {
  const edits = useMemoryEdits();
  const openSource = useOpenSource(navigate);
  const [editing, setEditing] = useState(false);
  const source = line.sources[0];
  const shown = source === undefined || source.kind === 'system' ? null : source;
  const tag = line.basis === 'contact' ? `${line.by ?? '对方'}说的` : BASIS_TAG[line.basis];
  if (editing) {
    return <li className="doc-line is-editing">
      <LineEditor initial={line.text} label="改这一条" onCancel={() => setEditing(false)}
        onSave={async (text) => {
          const problem = await edits.edit(docId, line, text);
          if (problem === null) setEditing(false);
          return problem;
        }} />
    </li>;
  }
  const text = (
    <span className="doc-line-text">
      {line.basis === 'tried' ? <AiMark label="Plasticine 自己试出来的" /> : null}
      <LineText line={line} navigate={navigate} />
      {tag === null ? null : <span className="tag tag-neutral doc-line-tag">{tag}</span>}
      {line.uncertainId === null ? null : <span className="tag tag-outline doc-line-tag">拿不准</span>}
    </span>
  );
  const menu = actions === undefined ? null : actions(() => setEditing(true));
  if (look === 'doc') {
    return (
      <li className="doc-line" data-basis={line.basis}>
        {text}
        {shown === null ? null : <SourceLink source={shown} open={openSource} />}
        {menu}
      </li>
    );
  }
  const said = line.at === undefined ? '' : timeText(line.at, now);
  return (
    <li className="doc-line doc-line-stacked" data-basis={line.basis} data-look={look}>
      {lead ?? null}
      <span className="doc-line-main">
        {text}
        {look === 'how' && shown !== null ? (
          <span className="doc-line-under text-meta">
            {said === '' ? null : <span>{said} ·</span>}<SourceLink source={shown} open={openSource} />
          </span>
        ) : null}
        {look === 'row' && line.scope !== undefined ? <span className="doc-line-under text-meta">{line.scope}</span>
          : null}
        {line.previous === undefined ? null : <span className="doc-line-was">之前：{line.previous}</span>}
      </span>
      {look === 'row' && said !== '' ? <time className="doc-line-at text-meta" dateTime={line.at}>{said}</time> : null}
      {menu}
    </li>
  );
}
