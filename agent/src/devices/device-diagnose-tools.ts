// 设备出问题时 AI 自己能查（11-16）：18:48 那次截图卡住，AI 只能看到「Mac 离线」，Mac 上的日志要经卡住的动作通道读，
// 读不到。现在：device_nodes 分两项说（客户端连着没有、动作通道在干什么）；device_logs 一次给齐服务器这边的报到记录和
// 这台设备最近的动作（领走、交回、结果），再让设备另起一条请求把自己的日志传上来（不走动作通道）；device_cancel 放下
// 卡住或不要了的动作。都是只读或只影响 Plasticine 自己，不用问他。

import { Type } from 'typebox';
import { NODE_ONLINE_MS } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';
import { defineTool, type Tool } from '../tools/index.ts';
import type { DeviceService } from './service.ts';

/** 等设备传日志最多这么久：设备每 20 秒报到一次，报到回复里要，再传上来。 */
const LOGS_WAIT_MS = 50_000;
const LOG_LINES_SHOWN = 400;
const ACTIONS_SHOWN = 40;
const HELLOS_SHOWN = 20;
const DEFAULT_MINUTES = 60;

type Devices = Pick<DeviceService, 'listNodes' | 'work' | 'logs' | 'board' | 'cancel'>;
type DiagnoseState = Pick<StateService, 'nodes' | 'nodeActions'>;

const NodeIdParameter = Type.String({ minLength: 1, description: 'device_nodes 给的设备 id' });

export function createDeviceNodesTool(devices: Pick<DeviceService, 'listNodes'>): Tool {
  return defineTool({ name: 'device_nodes', label: '设备节点',
    description: '列出配对的设备：id、平台、版本、会做的事、上限，和两项状态——online：客户端 90 秒内报过到；'
      + 'work：动作通道在干什么（idle 空着；busy 在做哪个动作、做到哪一步；stuck 超过时限还没交回）。'
      + 'online 是 false 不等于他那边断了：先看 work 和 lastSeenAt，拿不准就用 device_logs 查。'
      + 'device_action 要用在线设备的 id；iPhone 常不在线，它的动作等 App 下次打开才做。',
    parameters: Type.Object({}, { additionalProperties: false }),
    replay: 'safe', effect: 'read', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 1_000,
    execute: () => Promise.resolve(JSON.stringify(devices.listNodes())),
  });
}

function clock(iso: string | null): string | null {
  return iso === null ? null : new Date(iso).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

export function createDeviceLogsTool(state: DiagnoseState, devices: Devices): Tool {
  return defineTool({ name: 'device_logs', label: '设备日志',
    description: '查一台设备出了什么事：服务器这边最近的报到（每 20 秒一次，带当时在做什么）和发给它的动作'
      + '（什么时候发、什么时候领走、什么时候交回、结果），再让设备把它自己的日志传上来（不走动作通道，'
      + '动作卡住也能拿到；设备要在线，最多等 50 秒）。用来判断截图、报到、领动作、交结果哪一步出了错。',
    parameters: Type.Object({ nodeId: NodeIdParameter,
      minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 * 60,
        description: '看最近多少分钟（默认 60）' })) }, { additionalProperties: false }),
    replay: 'safe', effect: 'read', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 70_000,
    maxResultChars: 60_000,
    async execute(args, context) {
      const node = state.nodes.get(args.nodeId);
      if (node === undefined) {
        throw new Error('没有这台设备：先 device_nodes 看 id。');
      }
      const now = context.now();
      const since = new Date(now.getTime() - (args.minutes ?? DEFAULT_MINUTES) * 60_000).toISOString();
      const online = now.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS;
      const actions = state.nodeActions.recent(node.id, { limit: ACTIONS_SHOWN })
        .filter((row) => row.requestedAt >= since)
        .map((row) => ({ actionId: row.actionId, kind: row.kind, status: row.status, purpose: row.purpose,
          sent: clock(row.requestedAt), taken: clock(row.deliveredAt), done: clock(row.executedAt),
          reason: row.reason }));
      const hellos = devices.board.history(node.id).slice(-HELLOS_SHOWN).map((mark) => ({ at: clock(mark.at),
        busy: mark.busy === null ? null : `${mark.busy.kind} · ${mark.busy.step}（${clock(mark.busy.since)} 开始）` }));
      let device: unknown;
      if (devices.logs === null) {
        device = '这个服务没开设备日志。';
      } else if (!online) {
        const latest = devices.logs.latest(node.id);
        device = { note: `设备 ${clock(node.lastSeenAt)} 以后没报到，现在传不了；下面是以前传上来的最近一份。`,
          lines: latest?.lines.slice(-LOG_LINES_SHOWN) ?? [] };
      } else {
        const upload = await devices.logs.request(node.id, since, LOGS_WAIT_MS, context.signal);
        device = upload === null ? '设备在线但 50 秒里没把日志传上来（可能是旧版客户端，或报到也卡住了）。'
          : { lines: upload.lines.slice(-LOG_LINES_SHOWN), truncated: upload.truncated
            || upload.lines.length > LOG_LINES_SHOWN };
      }
      return JSON.stringify({ node: { id: node.id, name: node.name, appVersion: node.appVersion, online,
        lastSeen: clock(node.lastSeenAt), work: devices.work(node.id) }, hellos, actions, device });
    },
  });
}

export function createDeviceCancelTool(devices: Devices): Tool {
  return defineTool({ name: 'device_cancel', label: '取消设备动作',
    description: '取消一个设备动作：还没领走的直接作废；已经在做的，设备下次报到时放下（交回「取消了」）。'
      + '卡住的、不要了的用它；放下的那一步做没做成要自己核实。',
    parameters: Type.Object({ actionId: Type.String({ minLength: 1,
      description: 'device_logs 或 device_nodes 的 work 里的动作 id' }) }, { additionalProperties: false }),
    replay: 'safe', effect: 'internal', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 2_000,
    execute: (args) => {
      const before = devices.cancel(args.actionId);
      if (before === null) {
        throw new Error('没有这个动作。');
      }
      const said = before === 'queued' ? '还没领走，已作废。' : before === 'sent'
        ? '设备正在做，下次报到（20 秒内）时放下。' : `它已经是「${before}」了，不用取消。`;
      return Promise.resolve(JSON.stringify({ actionId: args.actionId, before, said }));
    },
  });
}
