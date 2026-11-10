import type { ReactNode } from 'react';
import { MAIN_LINE_ALIAS, type LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';

/** 交接署名来自保存的来源线，不能从任务文字猜名字。 */
export function MateHandoff({ line }: { line: LineView }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const thread = useStore(live.lines.thread(line.id));
  const instruction = thread.messages.find((message) => message.origin?.kind === 'delegation');
  const ref = instruction?.origin?.ref;
  const sourceId = ref == null ? null : /^line:(.+):\d+$/u.exec(ref)?.[1] ?? null;
  const source = useStore(live.lines.thread(sourceId ?? MAIN_LINE_ALIAS)).line;
  const to = roster.mates.find((mate) => mate.id === line.mateId);
  const from = roster.mates.find((mate) => mate.id === source?.mateId);
  if (to === undefined || sourceId === null || source === null) return null;
  const author = from?.name ?? (source.kind === 'main' || source.mateGroupId != null ? 'Plasticine' : null);
  if (author === null) return null;
  return <p className="mate-handoff"><span>{author}</span><span aria-hidden="true">→</span>
    <span>{to.name}</span><span className="mate-handoff-goal">{instruction?.text ?? line.title}</span></p>;
}
