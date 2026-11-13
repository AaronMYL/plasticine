// 网络第二批的截图场景（2026-11-05 设计稿 b6）：地址带 ?net= 换成设计稿里那几个人。
// - alex：Alex 这边——小林（交付了的任务卡、两边的 Plasticine 各一句）、群「杭州周末」（阿杰接了的卡、阿杰 @ Alex 的
//   Plasticine、周可发的还没人接的卡）、周可、阿杰、陈默、娜娜；
// - xiaolin：小林那边——Alex 发来的任务等他定、Alex 的好友请求在另一个号上看（新请求）、娜娜、阿杰；
// - welcome：新装的实例，还没加入网络（第一次打开的三步）。
// 时间都相对 now，标在「11-05 周四」那一天的样子。

import type { ContactMessageView, GroupTaskView, MemberFace, NetworkTaskView } from '../shared.ts';
import type { FakeContacts } from './fake-contacts.ts';
import type { FakeNetwork } from './fake-network.ts';

export type NetScene = 'alex' | 'xiaolin' | 'welcome' | 'connect' | 'states' | 'group';

const SCENES: readonly NetScene[] = ['alex', 'xiaolin', 'welcome', 'connect', 'states', 'group'];

export function netSceneOf(search: string): NetScene | null {
  const value = new URLSearchParams(search).get('net');
  return SCENES.find((scene) => scene === value) ?? null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TITLE = '帮我整理杭州周末适合带父母去的三个地方';
const RESULT = '1. 人民公园 · 鹤鸣茶社：喝茶看人，2 号线人民公园站，全程平路，上午人少\n'
  + '2. 杜甫草堂：园子平、树荫多，4 号线草堂北路站走 10 分钟\n'
  + '3. 望江楼公园：竹林和江边散步，3 号线磨子桥站，下午四点后凉快';

function at(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

/** 这周五 / 周六的某个钟点（本机时区）：任务卡的期限。 */
function weekday(now: Date, day: number, hour: number, minute = 0): string {
  const due = new Date(now);
  due.setDate(due.getDate() + ((day - due.getDay() + 7) % 7 || 7));
  due.setHours(hour, minute, 0, 0);
  return due.toISOString();
}

function line(id: string, author: ContactMessageView['author'], text: string, when: string,
  extra: Partial<ContactMessageView> = {}): ContactMessageView {
  return { id, author, text, at: when, status: 'sent', toAi: false, exchangeId: null, taskId: null, ...extra };
}

function face(handle: string, name: string, self = false): MemberFace {
  return { accountId: `acct_${handle}`, name, handle, avatar: null, self };
}

function task(fields: Partial<NetworkTaskView> & Pick<NetworkTaskView, 'id' | 'direction' | 'contactId'
  | 'state' | 'stage' | 'createdAt'>): NetworkTaskView {
  return { title: TITLE, goal: '三个地方，每个写清怎么去、走多少路、几点去人少', acceptance: '三个地方', deadline: null,
    doer: null, waiting: false, delivery: null, verdict: null, localTaskId: null, activity: null, attachment: null,
    decidedAt: null, updatedAt: fields.createdAt, version: 1, ...fields };
}

function seedAlex(contacts: FakeContacts, network: FakeNetwork, now: Date): void {
  network.seedJoined('alex', 'Alex');
  const me = face('alex', 'Alex', true);
  contacts.me = me;
  contacts.addPerson({ id: 'c_xiaolin', name: '小林', handle: 'xiaolin', relation: 'friend' });
  contacts.seedMessage('c_xiaolin', line('xl_1', 'me', '周末我爸妈来杭州，你熟，帮我挑几个地方？', at(now, 4 * HOUR)));
  contacts.seedMessage('c_xiaolin', line('xl_2', 'them', '行，发个任务给我，我让 Plasticine 先排', at(now, 4 * HOUR - 2 * MINUTE)));
  contacts.seedTask(task({ id: 'nt_xl_places', direction: 'out', contactId: 'c_xiaolin', state: 'delivered', stage: 4,
    doer: 'ai', waiting: true, deadline: weekday(now, 5, 18), createdAt: at(now, 4 * HOUR - 3 * MINUTE),
    decidedAt: at(now, 3 * HOUR), delivery: { text: RESULT, at: at(now, 70 * MINUTE) } }));
  contacts.seedMessage('c_xiaolin', line('xl_3', 'their_ai', '三个地方都按老人走得动的路线排了，想加一处吃饭的可以再说。',
    at(now, 69 * MINUTE)));
  contacts.seedMessage('c_xiaolin', line('xl_4', 'my_ai', '三处都在地铁边，周六晴，22°。', at(now, 9 * MINUTE)));
  contacts.people.get('c_xiaolin')!.unread = 1;
  contacts.addPerson({ id: 'c_zhouke', name: '周可', handle: 'zhouke', relation: 'partner' });
  contacts.seedMessage('c_zhouke', line('zk_1', 'them', '周五下午有空，老地方', at(now, 90 * MINUTE)));
  contacts.addPerson({ id: 'c_ajie', name: '阿杰', handle: 'ajie', relation: 'friend' });
  contacts.seedMessage('c_ajie', line('aj_1', 'them', '邀请码收到了，明天装', at(now, DAY + HOUR)));
  contacts.addPerson({ id: 'c_chenmo', name: '陈默', handle: 'chenmo', relation: 'friend' });
  contacts.seedMessage('c_chenmo', line('cm_1', 'them', '好，周日见', at(now, 3 * DAY)));
  contacts.addPerson({ id: 'c_nana', name: '娜娜', handle: 'nana', relation: 'friend' });
  contacts.directory.set('xiaolin', '小林');
  const lin = face('xiaolin', '小林');
  const zhou = face('zhouke', '周可');
  const jie = face('ajie', '阿杰');
  const members = [me, lin, zhou, jie];
  const groups = contacts.groupChats;
  groups.seed({ id: 'grp-hangzhou', name: '杭州周末', avatar: null, members, unread: 1 });
  groups.seedMessage('grp-hangzhou', line('g_1', 'them', '周六我上午有事，下午可以', at(now, 3 * HOUR), { sender: lin }));
  groups.seedMessage('grp-hangzhou', line('g_2', 'them', '我开车，周六都行', at(now, 3 * HOUR - MINUTE),
    { sender: zhou }));
  groups.seedMessage('grp-hangzhou', line('g_3', 'me', '那我发个卡，谁有空谁接', at(now, 3 * HOUR - 2 * MINUTE),
    { sender: me }));
  const base: Omit<GroupTaskView, 'id' | 'title' | 'goal' | 'owner' | 'state' | 'offeredAt'> = {
    groupId: 'grp-hangzhou', deadline: null, attachment: null, assignee: null, claimer: null, doer: null,
    claiming: false, canClaim: false, members, pair: null, claimedAt: null, version: 1 };
  groups.seedTask({ ...base, id: 'gt_pickup', title: '周六上午去东站接我爸妈，送到人民公园', goal: '东站接人，送到人民公园',
    deadline: weekday(now, 6, 9, 30), owner: me, state: 'claimed', claimer: jie, doer: 'person',
    claimedAt: at(now, 2 * HOUR - 7 * MINUTE), offeredAt: at(now, 3 * HOUR - 3 * MINUTE) });
  groups.seedMessage('grp-hangzhou', line('g_4', 'them', '上次你们去的那家茶馆叫什么？', at(now, 40 * MINUTE),
    { sender: jie, toAi: true, mention: { name: 'Alex', self: true } }));
  groups.seedMessage('grp-hangzhou', line('g_5', 'my_ai', '鹤鸣茶社，在人民公园里，离 2 号线人民公园站走 5 分钟。',
    at(now, 39 * MINUTE), { sender: me }));
  groups.seedTask({ ...base, id: 'gt_lunch', title: '周六中午帮忙订一桌川菜，6 个人，老人能吃的', goal: '6 个人，老人能吃的',
    deadline: weekday(now, 6, 11), owner: zhou, state: 'open', canClaim: true, offeredAt: at(now, 30 * MINUTE) });
}

/** ?net=group：在 alex 那个群上再加几句——一句同时 @ 两个人的 Plasticine、两边各回一句（11-13 群聊那几处）。 */
function seedGroupAsks(contacts: FakeContacts, now: Date): void {
  const groups = contacts.groupChats;
  const [me, lin, zhou] = [face('alex', 'Alex', true), face('xiaolin', '小林'), face('zhouke', '周可')];
  const asked = at(now, 20 * MINUTE);
  groups.seedMessage('grp-hangzhou', line('g_6', 'me', '周六下午谁有空一起去茶社？', asked,
    { sender: me, toAi: true, mention: { name: '小林', self: false } }));
  groups.seedMessage('grp-hangzhou', line('g_7', 'me', '周六下午谁有空一起去茶社？', asked,
    { sender: me, toAi: true, mention: { name: '周可', self: false } }));
  groups.seedMessage('grp-hangzhou', line('g_8', 'their_ai', '小林周六下午两点以后有空。', at(now, 19 * MINUTE),
    { sender: lin }));
  groups.seedMessage('grp-hangzhou', line('g_9', 'their_ai', '周可周六下午要开车接人，四点以后可以。',
    at(now, 18 * MINUTE), { sender: zhou }));
  groups.seedMessage('grp-hangzhou', line('g_10', 'them', '那就四点，茶社门口见，我带上次那副牌', at(now, 17 * MINUTE),
    { sender: lin }));
}

function seedXiaolin(contacts: FakeContacts, network: FakeNetwork, now: Date): void {
  network.seedJoined('xiaolin', '小林');
  contacts.me = face('xiaolin', '小林', true);
  contacts.addPerson({ id: 'c_alex', name: 'Alex', handle: 'alex', relation: 'friend' });
  contacts.seedMessage('c_alex', line('a_1', 'them', '周末我爸妈来杭州，你熟，帮我挑几个地方？', at(now, 4 * HOUR)));
  contacts.seedMessage('c_alex', line('a_2', 'me', '行，发个任务给我，我让 Plasticine 先排', at(now, 4 * HOUR - 2 * MINUTE)));
  contacts.seedTask(task({ id: 'nt_from_alex', direction: 'in', contactId: 'c_alex', state: 'offered', stage: 1,
    waiting: true, deadline: weekday(now, 5, 18), createdAt: at(now, 4 * HOUR - 3 * MINUTE) }));
  contacts.people.get('c_alex')!.unread = 1;
  contacts.addPerson({ id: 'c_nana', name: '娜娜', handle: 'nana', relation: 'friend' });
  contacts.seedMessage('c_nana', line('n_1', 'them', '周日去不去爬山', at(now, 6 * HOUR)));
  contacts.addPerson({ id: 'c_ajie', name: '阿杰', handle: 'ajie', relation: 'friend' });
  contacts.seedMessage('c_ajie', line('j_1', 'them', '你装好了没', at(now, DAY + HOUR)));
  contacts.addPerson({ id: 'c_alex2', name: 'Alex', handle: 'alex2', state: 'request', unread: 1 });
  contacts.seedMessage('c_alex2', line('r_1', 'them', '我是 Alex，周末那个任务想发给你', at(now, 3 * HOUR)));
}

/** 任务卡的各个进度（设计稿 Friend-Task-States）：发出去的四张（等点头、对方的 Plasticine 在做、交付了、收到了），
 * 收到的三张（等我定、我的 Plasticine 在做、我来做）。 */
function seedStates(contacts: FakeContacts, network: FakeNetwork, now: Date): void {
  network.seedJoined('alex', 'Alex');
  contacts.addPerson({ id: 'c_xiaolin', name: '小林', handle: 'xiaolin', relation: 'friend' });
  const due = weekday(now, 5, 18);
  const made = (minutes: number): string => at(now, minutes * MINUTE);
  const cards: NetworkTaskView[] = [
    task({ id: 's_offered', direction: 'out', contactId: 'c_xiaolin', state: 'offered', stage: 1, deadline: due,
      createdAt: made(70) }),
    task({ id: 's_running', direction: 'out', contactId: 'c_xiaolin', state: 'in_progress', stage: 3, doer: 'ai',
      deadline: due, createdAt: made(60), decidedAt: at(now, 192_000) }),
    task({ id: 's_delivered', direction: 'out', contactId: 'c_xiaolin', state: 'delivered', stage: 4, doer: 'ai',
      waiting: true, deadline: due, createdAt: made(50), delivery: { text: RESULT, at: made(45) } }),
    task({ id: 's_received', direction: 'out', contactId: 'c_xiaolin', state: 'passed', stage: 5, doer: 'ai',
      deadline: due, createdAt: made(40), delivery: { text: RESULT, at: made(38) },
      verdict: { verdict: 'pass', note: '', at: made(30) } }),
    task({ id: 's_incoming', direction: 'in', contactId: 'c_xiaolin', state: 'offered', stage: 1, waiting: true,
      deadline: due, createdAt: made(20) }),
    task({ id: 's_mine_ai', direction: 'in', contactId: 'c_xiaolin', state: 'in_progress', stage: 3, doer: 'ai',
      deadline: due, createdAt: made(15), activity: { text: '在核对营业时间…', since: at(now, 192_000) } }),
    task({ id: 's_mine_person', direction: 'in', contactId: 'c_xiaolin', state: 'accepted', stage: 2,
      doer: 'person', waiting: true, deadline: due, createdAt: made(10) }),
  ];
  for (const card of cards) {
    contacts.seedTask(card);
  }
}

export function seedNetworkScene(parts: { contacts: FakeContacts; network: FakeNetwork }, now: Date,
  scene: NetScene): void {
  if (scene === 'alex') {
    seedAlex(parts.contacts, parts.network, now);
  } else if (scene === 'group') {
    seedAlex(parts.contacts, parts.network, now);
    seedGroupAsks(parts.contacts, now);
  } else if (scene === 'xiaolin') {
    seedXiaolin(parts.contacts, parts.network, now);
  } else if (scene === 'states') {
    seedStates(parts.contacts, parts.network, now);
  } else {
    parts.network.seedWelcome();
  }
}
