// 记忆文档里的一行（从 topic-doc.tsx 拆出来，承诺和授权、主动告诉你、做事经验共用）：文字里的 [[名字]] 是双链；
// Plasticine 推断的标「推断」、还在「拿不准的」里的标「拿不准」；自己试出来的前面一个 ✦（记忆分层，11-15 设计稿）。
// 三种摆法：
// - doc（默认，关于你、人物、项目、话题）：文字在左、出处在右、行尾 ⋯。
// - how（做事经验）：文字下面一行是出处（哪件事、你说的），改过的再带一行「之前：…」。
// - row（承诺和授权、主动告诉你）：一行一条，下面一行只写有的（只限哪个项目、哪个人），右边是哪天说的。

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

/** 「回到原话」去哪：约定那一段里那一条、对话里那条消息、那篇笔记；图书先到图书馆。做事时试出来的另开那条线。 */
export function sourceRoute(source: MemoryLineSource): Route | null {
  switch (source.kind) {
    case 'system': return { view: 'memory', noteId: null };
    case 'agreement': return { view: 'memory', noteId: null, objectType: 'agreement', objectId: source.id };
    case 'message': return mainLineRoute(source.id);
    case 'note': return { view: 'notes', noteId: source.id };
    case 'book': return { view: 'books', noteId: null, bookId: source.id };
    case 'contact': return messagesRoute(source.id);
    case 'work': return null;
  }
}

/** 点一条出处：做事时试出来的打开那条线的面板，别的换页过去。 */
export function useOpenSource(navigate: (route: Route) => void): (source: MemoryLineSource) => void {
  // 壳外面（单独渲染这一页）没有面板可开：那一条出处点了不动。
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

/** 一行的文字：[[名字]] 对得上一篇就是能点的双链，对不上照原样（不带括号）显示。 */
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
  /** 行尾的 ⋯（各页自己的那一份菜单）；不给就没有。 */
  actions?: (edit: () => void) => ReactNode;
  /** 行首的小图标（承诺和授权：这一条从哪来）。 */
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
