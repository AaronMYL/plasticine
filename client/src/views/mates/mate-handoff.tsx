import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { MAIN_LINE_ALIAS, type LineMessageView, type LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { inputAuthor } from '../lines/line-origin.ts';

/** 交接署名来自保存的原始消息；用户在群组 @ 队友也不能署名成 Plasticine。 */
export function MateHandoff({ line }: { line: LineView }): ReactNode {
  const api = useApi();
  const live = useLive();
  const roster = useStore(live.mates.data);
  const thread = useStore(live.lines.thread(line.id));
  const instruction = thread.messages.find((message) => message.origin?.kind === 'delegation');
  const ref = instruction?.origin?.ref;
  const match = ref == null ? null : /^line:(.+):(\d+)$/u.exec(ref);
  const sourceId = match?.[1] ?? null;
  const seq = Number(match?.[2]);
  const source = useStore(live.lines.thread(sourceId ?? MAIN_LINE_ALIAS));
  const known = source.messages.find((message) => message.seq === seq);
  const [remote, setRemote] = useState<{ ref: string; message: LineMessageView | null;
    error: string | null } | null>(null);
  useEffect(() => {
    if (known !== undefined || sourceId === null || ref === undefined || !Number.isSafeInteger(seq) || seq < 1) return;
    const controller = new AbortController();
    void api.lines.read(sourceId, { before: seq + 1, limit: 1 }, controller.signal).then((response) => {
      if (!controller.signal.aborted) {
        setRemote({ ref, message: response.messages.find((message) => message.seq === seq) ?? null, error: null });
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setRemote({ ref, message: null, error: errorText(cause) });
    });
    return () => controller.abort();
  }, [api, sourceId, seq, ref, known]);
  const original = known ?? (remote?.ref === ref ? remote?.message : null);
  const to = roster.mates.find((mate) => mate.id === line.mateId);
  const from = roster.mates.find((mate) => mate.id === source.line?.mateId);
  if (to === undefined || sourceId === null) return null;
  let author = '来源未记录';
  if (original?.role === 'user') {
    author = original.origin?.kind === 'delegation' ? '来源未记录' : inputAuthor(original.origin);
  } else if (original?.role === 'assistant' || original?.role === 'toolResult') {
    author = from?.name ?? (source.line?.kind === 'main' || source.line?.mateGroupId != null
      ? 'Plasticine' : '来源未记录');
  }
  return <p className="mate-handoff"><span title={remote?.ref === ref ? remote?.error ?? undefined : undefined}>
    {author}</span><span aria-hidden="true">→</span><span>{to.name}</span>
    <span className="mate-handoff-goal">{instruction?.text ?? line.title}</span></p>;
}
