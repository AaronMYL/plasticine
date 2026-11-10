import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { MAIN_ACTOR, type ActorChoice, type BindingChoice } from './outbound-format.ts';

export interface OutboundChoices {
  bindings: BindingChoice[];
  actors: ActorChoice[];
  people: ReadonlyMap<string, string>;
  loading: boolean;
  error: string | null;
}

export function useOutboundChoices(): OutboundChoices {
  const api = useApi();
  const roster = useStore(useLive().mates.data);
  const [choices, setChoices] = useState<OutboundChoices>({ bindings: [],
    actors: [{ id: MAIN_ACTOR, label: 'Plasticine（主线）' }], people: new Map(), loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api.lines.list({ kind: 'background', limit: 100 }, controller.signal),
      api.tasks.board({}, controller.signal), api.projects.list({}, controller.signal),
      api.contacts.list(controller.signal)]).then(([lines, board, projects, contacts]) => {
      if (controller.signal.aborted) { return; }
      const bindings: BindingChoice[] = [
        ...lines.lines.filter((line) => line.id !== MAIN_ACTOR && line.kind === 'background')
          .map((line): BindingChoice => ({ id: line.id, kind: 'line', label: line.title })),
        ...board.timed.filter((row) => row.source === 'schedule')
          .map((row): BindingChoice => ({ id: row.id.slice('schedule:'.length), kind: 'schedule', label: row.title })),
        ...projects.projects.filter((project) => project.lifecycle !== 'done' && !project.standing)
          .map((project): BindingChoice => ({ id: project.id, kind: 'project', label: project.name })),
      ];
      setChoices((value) => ({ ...value, bindings,
        people: new Map(contacts.contacts.map((contact) => [contact.id, contact.name])),
        loading: false, error: null }));
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setChoices((value) => ({ ...value, loading: false, error: errorText(cause) }));
      }
    });
    return () => controller.abort();
  }, [api]);
  return { ...choices, error: choices.error ?? roster.error,
    actors: [{ id: MAIN_ACTOR, label: 'Plasticine（主线）' }, ...roster.mates.map((mate) => ({
      id: mate.id, label: mate.name + (mate.disabledAt === null ? '' : '（已停用）'), disabled: mate.disabledAt !== null,
    }))] };
}
