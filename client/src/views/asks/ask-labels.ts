import type { AskAnswerPlace, LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useMainName } from '../mates/main-identity.tsx';

interface Names {
  main: string;
  mate: (id: string) => string;
  lines: ReadonlyMap<string, LineView>;
}

function useNames(): Names {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const list = useStore(live.lines.list);
  const main = useMainName();
  return {
    main,
    mate: (id) => roster.mates.find((item) => item.id === id)?.name ?? '队友',
    lines: new Map(list.lines.map((line) => [line.id, line])),
  };
}

function lineLabel(line: LineView, names: Names): string {
  if (line.kind === 'main') return names.main;
  if (line.mateGroupId != null) return line.title;
  if (line.mateId != null && line.parentLineId === null) return names.mate(line.mateId);
  if (line.mateId != null) return `${names.mate(line.mateId)} · ${line.title}`;
  return line.title;
}

export function useLineLabel(): (line: LineView) => string {
  const names = useNames();
  return (line) => lineLabel(line, names);
}

export function useAskOrigin(): (ask: AskView) => string | null {
  const names = useNames();
  return (ask) => {
    const line = ask.lineId === null ? undefined : names.lines.get(ask.lineId);
    return line === undefined ? null : lineLabel(line, names);
  };
}

export function usePlaceText(): (place: AskAnswerPlace | undefined) => string | null {
  const names = useNames();
  return (place) => {
    if (place === undefined) return null;
    if (place.kind === 'wait') return '在「等你」里定的';
    if (place.kind === 'chat') return '在聊天里定的';
    const line = names.lines.get(place.lineId);
    return line === undefined ? null : `在${lineLabel(line, names)}的对话里定的`;
  };
}
