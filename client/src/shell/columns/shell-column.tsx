import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ArchivedTab } from '../../state/web-tabs.ts';
import { EASE_OUT, ENTER_KEYFRAMES, MOTION, play } from '../motion.ts';
import type { Route } from '../routes.ts';
import { SECTIONS, type SectionId } from '../sections.ts';
import { LibraryColumn } from './library-column.tsx';
import { MessagesColumn } from './messages-column.tsx';
import { NotesColumn } from './notes-column.tsx';
import { ReadingColumn } from './reading-column.tsx';
import { PlasticineColumn } from './plasticine-column.tsx';
import { TasksColumn } from './tasks-column.tsx';
import { WebColumn } from './web-column.tsx';
import { WebStrip } from './web-strip.tsx';

const SWITCH_KEYFRAMES: Keyframe[] = ENTER_KEYFRAMES;

export interface ShellColumnProps {
  section: SectionId;
  route: Route;
  navigate: (route: Route) => void;
  webId: string | null;
  onOpenTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReopen: (entry: ArchivedTab) => void;
  onAsk: () => void;
  collapsed: boolean;
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
    case 'reading': return <ReadingColumn route={route} navigate={navigate} />;
    case 'notes': return <NotesColumn route={route} navigate={navigate} />;
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
