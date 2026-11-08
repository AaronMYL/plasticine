// 第二栏（252 宽）：按栏目换内容。换栏目时新内容淡入并从左边 6px 滑进来（11-07：栏目切换时第二栏内容淡入 + 轻微位移），
// 减少动态效果时直接换。11-08 能收起（column-toggle.tsx）：网页收成 56 宽的窄栏（web-strip.tsx），别的栏目宽度收到 0、
// 里面的东西留着（滚动位置不丢）但不可达；宽度有动画（column.css，减少动态效果时直接变）。

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ArchivedTab } from '../../state/web-tabs.ts';
import { EASE_OUT, MOTION, play } from '../motion.ts';
import type { Route } from '../routes.ts';
import { SECTIONS, type SectionId } from '../sections.ts';
import { FeedColumn } from './feed-column.tsx';
import { LibraryColumn } from './library-column.tsx';
import { MessagesColumn } from './messages-column.tsx';
import { NotesColumn } from './notes-column.tsx';
import { PlasticineColumn } from './plasticine-column.tsx';
import { TasksColumn } from './tasks-column.tsx';
import { WebColumn } from './web-column.tsx';
import { WebStrip } from './web-strip.tsx';

const SWITCH_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translateX(-6px)' },
  { opacity: 1, transform: 'translateX(0)' },
];

export interface ShellColumnProps {
  section: SectionId;
  route: Route;
  navigate: (route: Route) => void;
  /** 主区开着的网页标签。 */
  webId: string | null;
  onOpenTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReopen: (entry: ArchivedTab) => void;
  /** 「跟 Plasticine 说」：对话框展开。 */
  onAsk: () => void;
  /** 这个栏目的第二栏收起来了。 */
  collapsed: boolean;
  /** 窄栏上的「搜标签」：打开 ⌘K。 */
  onSearch: () => void;
}

function Body(props: ShellColumnProps): ReactNode {
  const { route, navigate } = props;
  switch (props.section) {
    case 'plasticine': return <PlasticineColumn route={route} navigate={navigate} />;
    case 'messages': return <MessagesColumn route={route} navigate={navigate} />;
    case 'tasks': return <TasksColumn route={route} navigate={navigate} />;
    case 'web':
      return <WebColumn currentId={props.webId} onOpen={props.onOpenTab} onClose={props.onCloseTab}
        onReopen={props.onReopen} onNew={() => navigate({ view: 'web', noteId: null, webTabId: null })} />;
    case 'feed': return <FeedColumn route={route} navigate={navigate} />;
    case 'notes': return <NotesColumn navigate={navigate} />;
    case 'library': return <LibraryColumn route={route} navigate={navigate} onAsk={props.onAsk} />;
    case 'now': return null;
  }
}

function Switch({ children }: { children: ReactNode }): ReactNode {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    play(element.current, SWITCH_KEYFRAMES, MOTION.base, EASE_OUT);
  }, []);
  return <div ref={element} className="column-body">{children}</div>;
}

export function ShellColumn(props: ShellColumnProps): ReactNode {
  const strip = props.collapsed && props.section === 'web';
  const hidden = props.collapsed && !strip;
  return (
    <aside className="column" aria-label={SECTIONS[props.section].label} data-section={props.section}
      data-collapsed={strip ? 'strip' : hidden ? 'hidden' : undefined} inert={hidden} aria-hidden={hidden || undefined}>
      {strip ? (
        <Switch key="web:strip">
          <WebStrip currentId={props.webId} onOpen={props.onOpenTab} onClose={props.onCloseTab}
            onNew={() => props.navigate({ view: 'web', noteId: null, webTabId: null })} onSearch={props.onSearch} />
        </Switch>
      ) : <Switch key={props.section}><Body {...props} /></Switch>}
    </aside>
  );
}
