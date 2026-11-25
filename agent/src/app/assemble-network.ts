import type { AskDesk, ContactAlert } from '../attention/index.ts';
import type { TextModels } from '../kernel/index.ts';
import type { LineKernel } from '../lines/index.ts';
import { DEFAULT_RELAY_URL, NetworkService } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import type { AssembleOptions } from './assemble.ts';
import { publishNetworkChange } from './contact-streams.ts';
import type { EventHub } from './event-hub.ts';
import { contactAlerts } from './reply-alerts.ts';

interface NetworkParts {
  state: StateService;
  now: () => Date;
  desk: AskDesk;
  hub: EventHub;
  text: TextModels;
  late: { get(): LineKernel };
  joined: () => void;
  alert: (alert: ContactAlert) => void;
}

export function createNetwork(options: AssembleOptions, parts: NetworkParts): NetworkService {
  const { state, hub, late } = parts;
  const settings = options.network ?? {};
  const network: NetworkService = new NetworkService({
    state,
    now: parts.now,
    desk: parts.desk,
    lines: {
      open: (input, after) => late.get().open({ title: input.title, goal: input.goal, projectId: null,
        parentLineId: null, origin: { kind: 'network' },
        ...(input.sealedPrompt === undefined ? {} : { sealedPrompt: input.sealedPrompt }) },
      after).id,
      send: (lineId, text, after) => {
        late.get().send(lineId, { text, origin: { kind: 'network' } }, after);
      },
      answer: (lineId) => late.get().answer(lineId),
      status: (lineId) => late.get().status(lineId),
      activity: (lineId) => late.get().activity(lineId),
      execution: (lineId) => {
        if (late.get().status(lineId) === null) {
          return null;
        }
        const { status, pauseReason, outcome, pausedUntil, failure, queued } = late.get().view(lineId);
        return { status, pauseReason, outcome, pausedUntil, failure, queued };
      },
      halt: (lineId) => {
        late.get().halt(lineId);
      },
      settled: () => late.get().settled(),
    },
    relayUrl: settings.relayUrl ?? DEFAULT_RELAY_URL,
    autoSync: settings.autoSync ?? true,
    ...(settings.pollWaitSeconds === undefined ? {} : { pollWaitSeconds: settings.pollWaitSeconds }),
    ...(settings.fetch === undefined ? {} : { fetch: settings.fetch }),
    responder: settings.responder !== false,
    changed: (change) => {
      publishNetworkChange({ state, hub, activity: (task) => network.taskActivity(task),
        execution: (task) => network.taskExecution(task) }, change);
      for (const alert of contactAlerts(state, change)) {
        parts.alert(alert);
      }
    },
    onJoined: parts.joined,
  });
  return network;
}
