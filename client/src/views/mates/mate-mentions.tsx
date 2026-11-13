import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useDismiss } from '../../shell/use-dismiss.ts';
import { MateAvatar } from './mate-avatar.tsx';

export function useMateMentions({ lineId, draft, input, change }: { lineId: string; draft: string;
  input: RefObject<HTMLTextAreaElement | null>; change: (value: string) => void }): {
    popup: ReactNode; update: (caret: number) => void; keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
    listId: string | undefined; selectedId: string | undefined;
  } {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const line = useStore(live.lines.thread(lineId)).line;
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const group = roster.groups.find((item) => item.id === line?.mateGroupId);
  const allowed = line?.kind === 'main' || group !== undefined;
  const before = draft.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(before);
  const query = match?.[1] ?? '';
  const start = match === null ? -1 : before.lastIndexOf('@');
  const matches = roster.mates.filter((mate) => mate.disabledAt === null && mate.name.includes(query)
    && (group === undefined || group.mateIds.includes(mate.id)));
  const shown = open && allowed && match !== null && matches.length > 0;
  const active = Math.min(selected, matches.length - 1);
  useDismiss({ open: shown, inside: [panel, input], onDismiss: () => setOpen(false) });
  const choose = (name: string): void => {
    const next = `${draft.slice(0, start)}@${name} ${draft.slice(caret)}`;
    change(next); setOpen(false);
    queueMicrotask(() => { input.current?.focus(); input.current?.setSelectionRange(start + name.length + 2,
      start + name.length + 2); });
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!shown || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const mate = matches[active];
      if (mate !== undefined) { event.preventDefault(); choose(mate.name); return true; }
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return true; }
    return false;
  };
  return { update: (next) => { setCaret(next); setOpen(true); setSelected(0); }, keyDown,
    listId: shown ? id : undefined, selectedId: shown ? `${id}-${active}` : undefined,
    popup: !shown ? null : <div ref={panel} id={id} className="mate-mention-menu" role="listbox" aria-label="选择队友">
      {matches.map((mate, index) => <button key={mate.id} id={`${id}-${index}`} type="button" role="option"
        aria-selected={index === active} onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(mate.name)}>
        <MateAvatar mate={mate} size={24} still /><span>{mate.name}<small>{mate.role}</small></span>
      </button>)}
    </div> };
}
