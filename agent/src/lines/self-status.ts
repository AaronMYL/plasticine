// 「你现在的状态」（11-12 主动性一批，Aaron：「清楚知道自己能做什么、正在做什么、还缺什么」）：每次请求前从库里现读，
// 写进系统提示——在做的、排着的、等他的、没做成的后台工作各列几条，电脑在不在线。为的是三件事：
// 不重复开同一件事（先看这里有没有在做）、没做成的有人跟（看原因换办法或告诉他缺什么）、要用电脑的事先知道电脑在不在。
// 只读库，不调模型；没有这些表的地方（测试里的内核）就不写这一节。

import type { DeviceNode } from '../../shared/state.ts';
import type { LineRow, StateService } from '../state/index.ts';

export type StatusState = Partial<Pick<StateService, 'lines' | 'nodes' | 'mates'>>;

/** 最近一分半来过算在线（和设备那边同一个数）。 */
const ONLINE_MS = 90_000;
/** 每一类最多列这么多条：提示要短，多的写「还有 n 件」。 */
const PER_GROUP = 5;
const TITLE_MAX = 40;
const REASON_MAX = 80;
/** 没做成的只看最近两天：更早的他多半已经看过或不要了。 */
const FAILED_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const COMPUTERS: ReadonlySet<string> = new Set(['macos', 'windows', 'linux']);

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function row(line: LineRow, mates: StatusState['mates'], extra = ''): string {
  const mate = line.mateId == null ? undefined : mates?.get(line.mateId);
  return `- 「${clip(line.title, TITLE_MAX)}」（${line.id}${mate === undefined ? '' : `，${mate.name}在做`}）${extra}`;
}

function group(title: string, lines: readonly LineRow[], render: (line: LineRow) => string): string[] {
  if (lines.length === 0) {
    return [];
  }
  const more = lines.length > PER_GROUP ? [`- 还有 ${lines.length - PER_GROUP} 件`] : [];
  return [`${title}（${lines.length}）：`, ...lines.slice(0, PER_GROUP).map(render), ...more];
}

function computers(nodes: readonly DeviceNode[], now: Date): string {
  const own = nodes.filter((node) => node.revokedAt === null && COMPUTERS.has(node.platform));
  if (own.length === 0) {
    return '电脑：还没有连上电脑。要用他电脑上的登录、文件、应用的事现在做不了，直接告诉他要先在电脑上装客户端并连上。';
  }
  const online = own.filter((node) => now.getTime() - Date.parse(node.lastSeenAt) <= ONLINE_MS);
  const names = (list: readonly DeviceNode[]): string => list.map((node) => node.name).join('、');
  return online.length > 0 ? `电脑：${names(online)} 在线。`
    : `电脑：${names(own)} 现在不在线。要用电脑的事会排着等它上线；急的话告诉他把电脑打开。`;
}

/** 每位队友现在在干什么：正在回话、有几件后台在做、等他回答，还是空着。交给谁之前先看谁空着、谁已经在做这件事。 */
function mateRows(state: StatusState, background: readonly LineRow[], current: LineRow): string[] {
  const mates = state.mates?.active() ?? [];
  if (mates.length === 0 || state.lines === undefined) {
    return [];
  }
  const rows = mates.map((mate) => {
    const own = state.lines?.get(mate.lineId);
    const work = background.filter((line) => line.mateId === mate.id
      && (line.status === 'running' || line.status === 'queued'));
    const doing = [
      ...(mate.lineId !== current.id && own?.status === 'running' ? ['正在自己的对话里回话'] : []),
      ...(own?.status === 'waiting' ? ['在等他回答'] : []),
      ...(work.length === 0 ? [] : [`后台在做 ${work.length} 件（${work.slice(0, 2)
        .map((line) => `「${clip(line.title, 20)}」`).join('、')}${work.length > 2 ? '…' : ''}）`]),
    ];
    return `- ${mate.name}（${mate.id}，${clip(mate.role, 24)}）：${doing.length === 0 ? '空着' : doing.join('，')}`;
  });
  return ['队友：', ...rows];
}

/** 当前这条线自己不列（它就是「正在做」的那件）。 */
export function statusSection(state: StatusState, current: LineRow, now: Date): string {
  if (state.lines === undefined) {
    return '';
  }
  const all = state.lines.list({ kind: 'background', visibleOnly: true, limit: 200 })
    .filter((line) => line.id !== current.id && line.archivedAt === null);
  const by = (status: LineRow['status']): LineRow[] => all.filter((line) => line.status === status);
  const failedSince = now.getTime() - FAILED_WINDOW_MS;
  const failed = all.filter((line) => (line.status === 'failed' || (line.status === 'idle' && line.unmetReason !== null))
    && Date.parse(line.updatedAt) >= failedSince);
  const parts = [
    ...group('在做', by('running'), (line) => row(line, state.mates)),
    ...group('排着队', by('queued'), (line) => row(line, state.mates)),
    ...group('等他回答', by('waiting'), (line) => row(line, state.mates)),
    ...group('暂停着', by('paused'), (line) => row(line, state.mates)),
    ...group('没做成', failed, (line) => row(line, state.mates,
      `：${clip(line.failure ?? line.unmetReason ?? '原因没记下', REASON_MAX)}`)),
  ];
  const work = [...(parts.length === 0 ? ['后台现在没有在做的事。'] : parts), ...mateRows(state, all, current)];
  const rules = [
    '开新的后台线或交给队友之前先看上面：已经有一件在做同样的事（不管是谁在做），就用 tell_line 补一句或等它的结果，不再开一件；',
    '同一件事只交给一位队友，交的时候写清要什么结果、交回给谁；队友交回来的结果你要看过、汇总给他，不要漏掉哪一位的。',
    '「没做成」的不要放着：用 read_line 看它停在哪一步、为什么，能换办法就接着做（tell_line 让它继续，或另开一件说明换了什么办法），',
    '缺东西（电脑不在线、没登录、没权限、要他定）就明白告诉他缺什么。他问「在做什么」「做到哪了」，照这里和 list_lines 的实际情况答。',
  ];
  const machines = state.nodes === undefined ? [] : [computers(state.nodes.list({ limit: 50 }), now)];
  return ['## 你现在的状态', ...work, ...machines, ...rules].join('\n');
}
