// 回来看、盯着（timers/）在这里接上：叫醒线走线的 send（系统发起的一句）；盯网页用公网读取（不经模型、不花搜索额度），
// 盯 Mac 上的标签走设备动作 tab_read（同一套上限和记录）。

import { htmlToText, PublicFetcher } from '../cloud-tools/index.ts';
import type { DeviceActions } from '../devices/index.ts';
import { realLater, type LineKernel } from '../lines/index.ts';
import type { LineWatch, StateService } from '../state/index.ts';
import { LineTimers } from '../timers/index.ts';
import type { EventHub } from './event-hub.ts';

/** 一页最多读这么多字节、等这么久：盯的是公告、价格这类普通网页。 */
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;

async function readPage(fetcher: PublicFetcher, url: string, signal: AbortSignal): Promise<string> {
  const page = await fetcher.get(url, { accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', types: null,
    maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS, userAgent: 'PlasticineWatch/1.0' }, signal);
  const body = page.data.toString('utf8');
  return page.type.includes('html') ? htmlToText(body) : body;
}

async function readTab(devices: Pick<DeviceActions, 'perform'>, watch: LineWatch, signal: AbortSignal)
  : Promise<string> {
  if (watch.tab === null) {
    throw new Error('这一处不是网页标签。');
  }
  const outcome = await devices.perform({ actionId: `watch:${watch.id}:${watch.checks + 1}`, nodeId: watch.tab.nodeId,
    action: { kind: 'tab_read', tabId: watch.tab.tabId, offset: 0 }, origin: 'brain', taskId: null,
    runId: `line:${watch.lineId}`, purpose: `盯着变化：${watch.title}`, signal });
  const text: unknown = outcome.status === 'executed' && typeof outcome.result === 'object' && outcome.result !== null
    ? Reflect.get(outcome.result, 'text') : undefined;
  if (typeof text !== 'string') {
    throw new Error(outcome.reason ?? '这次没读到那个标签（Mac 不在线或标签关了）。');
  }
  return text;
}

export function assembleLineTimers(parts: { state: StateService; now: () => Date; hub: EventHub;
  lines: () => Pick<LineKernel, 'send'>; devices: Pick<DeviceActions, 'perform'>; fetcher?: PublicFetcher })
  : LineTimers {
  const fetcher = parts.fetcher ?? new PublicFetcher();
  return new LineTimers({ state: parts.state, now: parts.now, later: realLater,
    wake: (lineId, text, ref) => {
      parts.lines().send(lineId, { text, origin: { kind: 'trigger', ref } });
    },
    read: (watch, signal) => (watch.url === null ? readTab(parts.devices, watch, signal)
      : readPage(fetcher, watch.url, signal)),
    changed: () => parts.hub.publish({ type: 'tasks_changed' }) });
}
