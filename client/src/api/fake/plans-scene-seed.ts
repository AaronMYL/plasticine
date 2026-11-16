// ?scene=plans（11-16 截图用）：主线里一张图表和一张能排序、带合计的表，下面是正在做的「海投打招呼」那件事
// （列了 5 步、做到第 3 步）；设置里三个连接（一个没连上）；主动告诉你里三条推到手机的记录（一条撤回了）。
// 全是虚构的公司和人。

import type { ChartWidget, LineMessageView, TableWidget } from '../shared.ts';
import type { FakeConnections, FakePushes } from './fake-connections.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

type Draft = Omit<LineMessageView, 'lineId' | 'seq'>;

export const PLANS_TASK_ID = 'line-plans-boss';

function message(fields: Partial<Draft> & { createdAt: string }): Draft {
  return { role: 'assistant', text: '', origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    ...fields };
}

const CHART: ChartWidget = { kind: 'chart', id: 'w-plans-chart', title: '最近 7 天打招呼', type: 'bar', unit: '份',
  series: [{ name: '打招呼', points: [['11-10', 12], ['11-11', 18], ['11-12', 9], ['11-13', 22], ['11-14', 31],
    ['11-15', 27], ['11-16', 37]].map(([x, y]) => ({ x: String(x), y: Number(y) })) }] };

const TABLE: TableWidget = { kind: 'table', id: 'w-plans-table', caption: '这周的投递', total: true,
  columns: [{ key: 'company', label: '公司' }, { key: 'role', label: '岗位' }, { key: 'day', label: '投递日' },
    { key: 'state', label: '状态' }, { key: 'talks', label: '沟通次数', align: 'end' }],
  rows: [{ company: '示例科技', role: '产品经理', day: '11-16', state: '已读', talks: '1' },
    { company: '样例网络', role: 'AI 产品', day: '11-16', state: '已回', talks: '1' },
    { company: '示例数据', role: '产品助理', day: '11-15', state: '未读', talks: '1' },
    { company: '样例智能', role: 'AI 产品经理', day: '11-14', state: '已回', talks: '2' }] };

export function seedPlansScene(lines: FakeLines, connections: FakeConnections, pushes: FakePushes, now: Date):
  void {
  const at = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
  const said = '今天投了多少？给我看看这周的情况。';
  lines.record(MAIN_LINE_ID, message({ role: 'user', text: said, origin: { kind: 'user', userText: said },
    createdAt: at(4) }));
  lines.record(MAIN_LINE_ID, message({ text: '今天 37 份，比昨天多 10 份；这周 4 家有回音，2 家回了。',
    steps: [{ toolCallId: 'plans-widgets', tool: 'show_widgets', say: '放图表和表格' }], stopReason: 'toolUse',
    createdAt: at(3) }));
  lines.record(MAIN_LINE_ID, message({ role: 'toolResult', toolCallId: 'plans-widgets', tool: 'show_widgets',
    say: '放图表和表格', ok: true, text: '已放好', widgets: [CHART, TABLE], createdAt: at(3) }));
  const last = lines.record(MAIN_LINE_ID, message({ text: '海投还在做，做到第 3 步。', stopReason: 'stop',
    createdAt: at(3) }));
  lines.put(lines.blank(PLANS_TASK_ID, 'background', '海投打招呼 · 200 份', { parentLineId: MAIN_LINE_ID,
    parentMessageSeq: last.seq, status: 'running', activeSince: at(26),
    activity: '给「示例科技 · 产品经理」打招呼，用你给的原文',
    plan: [{ text: '打开招聘网站的消息页', status: 'done' }, { text: '只看成都的岗位，排除投过的', status: 'done' },
      { text: '打招呼 · 37 / 200', status: 'running' }, { text: '半小时后回来看回复', status: 'todo' },
      { text: '整理成表发给你', status: 'todo' }] }));
  connections.seed({ requestId: 'req_plans_notion', name: 'Notion', url: 'https://mcp.example.com/notion' });
  connections.seed({ requestId: 'req_plans_github', name: 'GitHub', url: 'https://mcp.example.com/github' });
  connections.seed({ requestId: 'req_plans_feishu', name: '飞书', url: 'https://mcp.example.com/feishu-fail' }, true);
  pushes.seed({ id: 'push_plans_1', title: '示例科技回你了：「方便明天下午聊吗？」', from: '求职顾问',
    lineId: PLANS_TASK_ID, url: `/#/work/${PLANS_TASK_ID}` }, 8);
  pushes.seed({ id: 'push_plans_2', title: '公众号第一篇排好了，等你预览', from: '公众号主编',
    lineId: MAIN_LINE_ID, url: '/#/plasticine' }, 39);
  pushes.seed({ id: 'push_plans_3', title: '明早 9 点的面试提前半小时出门', from: '主线', lineId: MAIN_LINE_ID,
    url: '/#/plasticine' }, 79, true);
}
