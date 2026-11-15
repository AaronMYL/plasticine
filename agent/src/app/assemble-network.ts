// 把联系人与网络这一头（network/）装起来：进来的话记成来源，「让 Plasticine 做」开一条后台线，改动提交以后推给界面，
// 该通知的交给推送。只给 assemble.ts 用。

import type { AskDesk, ContactAlert } from '../attention/index.ts';
import { contactTrigger, type RecordInput } from '../intake/index.ts';
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
  /** 新内核（装好以前先占位）。 */
  late: { get(): LineKernel };
  record: (input: RecordInput) => void;
  /** 加入网络以后（叫醒隧道）。 */
  joined: () => void;
  /** 第13批：对方发来的一句该通知时（推送服务装好以前是空的）。 */
  alert: (alert: ContactAlert) => void;
}

/** 第 113 条：联系人与网络。进来的人话、AI 话记成来源；「让 Plasticine 做」开一条后台线；改动提交以后推给界面。 */
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
    recordSource: (message, contact) => parts.record(contactTrigger(message, contact)),
    changed: (change) => {
      publishNetworkChange({ state, hub, activity: (task) => network.taskActivity(task),
        execution: (task) => network.taskExecution(task) }, change);
      // 第13批：对方本人发来的文字（一对一、群里）通知「谁 + 开头」，同一个群连着来的合成一条。
      for (const alert of contactAlerts(state, change)) {
        parts.alert(alert);
      }
    },
    onJoined: parts.joined,
  });
  return network;
}
