// 本地开发和测试用的联系人示例（照设计稿第二版）：林一（合作方，一条在做的任务、一段 AI↔AI、交付记录）、周可（陌生人，
// 一条等你表态的任务）、陈默（朋友）、阿杰（合作方，交付过）、一个新请求（小满），站内信里的一封阿里云邮件和巡查，
// 两条 Plasticine 通知（进「设置 · 通知记录」）。网络已加入（@alex），对外可见有三处建议待确认。时间都相对 now。

import type { ContactMessageView, MaterialRow, NetworkTaskView } from '../shared.ts';
import type { FakeContacts } from './fake-contacts.ts';
import type { FakeInbox } from './fake-inbox.ts';
import type { FakeNetwork, FakeVisibility } from './fake-network.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface ContactsSeedParts {
  contacts: FakeContacts;
  inbox: FakeInbox;
  network: FakeNetwork;
  visibility: FakeVisibility;
}

function ago(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

/** n 天后的这个钟点（本机时区）：期限一般落在整点。 */
function dueIn(now: Date, days: number, hour: number): string {
  const due = new Date(now.getTime() + days * DAY);
  due.setHours(hour, 0, 0, 0);
  return due.toISOString();
}

function line(id: string, author: ContactMessageView['author'], text: string, at: string,
  extra: Partial<ContactMessageView> = {}): ContactMessageView {
  return { id, author, text, at, status: 'sent', toAi: false, exchangeId: null, taskId: null, ...extra };
}

function task(fields: Pick<NetworkTaskView, 'id' | 'direction' | 'contactId' | 'title' | 'goal' | 'acceptance'
  | 'state' | 'stage' | 'createdAt' | 'updatedAt'> & Partial<NetworkTaskView>): NetworkTaskView {
  return {
    deadline: null,
    doer: null,
    waiting: false,
    delivery: null,
    verdict: null,
    localTaskId: null,
    version: 1,
    ...fields,
  };
}

const LIN_EXCHANGE: ReadonlyArray<[ContactMessageView['author'], string]> = [
  ['my_ai', '表格按场次一行，列是品牌、商品、佣金、退货。'],
  ['their_ai', '退货按下单还是按签收算？'],
  ['my_ai', '按签收，退货率另起一列。'],
  ['their_ai', '收到。佣金要税前还是税后？'],
  ['my_ai', '税前，备注里写税率。'],
  ['their_ai', '对齐了表格格式和退货口径。我先按样例做一场给你看。'],
];

function seedLin(contacts: FakeContacts, now: Date): void {
  const id = 'c_linyi';
  contacts.addPerson({ id, name: '林一', handle: 'linyi', relation: 'partner',
    suggestion: '好，周四晚上我看第一版',
    said: [
      { id: 'said_lin_1', text: '周五下午有空', tier: 'partner', at: ago(now, 3 * DAY) },
      { id: 'said_lin_2', text: '商单复盘先看退货', tier: 'partner', at: ago(now, 5 * DAY) },
    ] });
  contacts.seedTask(task({ id: 'nt_lin_script', direction: 'out', contactId: id, title: '直播脚本校对',
    goal: '校对 3 场直播脚本的口播和价格', acceptance: '每场一份改过的脚本', state: 'passed', stage: 5, doer: 'ai',
    createdAt: ago(now, 21 * DAY), updatedAt: ago(now, 19 * DAY), version: 4,
    delivery: { text: '3 份脚本已改好，价格都和后台对过。', at: ago(now, 20 * DAY) },
    verdict: { verdict: 'pass', note: '', at: ago(now, 19 * DAY) } }));
  contacts.seedTask(task({ id: 'nt_lin_poster', direction: 'out', contactId: id, title: '活动海报文案',
    goal: '双十一活动海报的主标题和三句卖点', acceptance: '两版文案可选', state: 'passed', stage: 5, doer: 'ai',
    createdAt: ago(now, 8 * DAY), updatedAt: ago(now, 6 * DAY), version: 4,
    delivery: { text: '两版文案见附件。', at: ago(now, 7 * DAY) },
    verdict: { verdict: 'pass', note: '用第二版', at: ago(now, 6 * DAY) } }));
  contacts.seedMessage(id, line('cm_lin_1', 'them',
    '下周要给品牌方交 10 场直播的复盘，你那边的 Plasticine 能帮我把商单整理成表吗？', ago(now, 130 * MINUTE)));
  contacts.seedMessage(id, line('cm_lin_2', 'me', '可以，我发一条任务给你。', ago(now, 128 * MINUTE), {
    reactions: [{ emoji: '👍', mine: false, count: 1 }] }));
  contacts.seedTask(task({ id: 'nt_lin_review', direction: 'out', contactId: id,
    title: '把 10 场直播的商单整理成复盘表', goal: '10 场直播的商单按场次整理成一张表，带佣金和退货',
    acceptance: '一张表，每场一行，能看出退货率', state: 'in_progress', stage: 2, doer: 'ai',
    deadline: dueIn(now, 3, 18), createdAt: ago(now, 125 * MINUTE), updatedAt: ago(now, 40 * MINUTE), version: 3 }));
  LIN_EXCHANGE.forEach(([author, text], index) => {
    contacts.seedMessage(id, line(`cm_lin_ex_${index}`, author, text, ago(now, (100 - index * 8) * MINUTE),
      { exchangeId: 'ex_lin_format' }));
  });
  contacts.seedMessage(id, line('cm_lin_3', 'their_ai', '样例收到了，周四晚上交第一版。', ago(now, 10 * MINUTE)));
}

function seedZhou(contacts: FakeContacts, now: Date): void {
  const id = 'c_zhouke';
  contacts.addPerson({ id, name: '周可', handle: 'zhouke', relation: 'stranger' });
  contacts.seedMessage(id, line('cm_zhou_1', 'them',
    '在 X 上看到你做的 Plasticine。我有 3 份用户访谈稿，想整理成要点，能接吗？', ago(now, 62 * MINUTE)));
  contacts.seedMessage(id, line('cm_zhou_2', 'my_ai', '我问一下主人，点头了就开始。', ago(now, 61 * MINUTE)));
  contacts.seedTask(task({ id: 'nt_zhou_interviews', direction: 'in', contactId: id, title: '整理 3 份访谈稿的要点',
    goal: '把 3 份用户访谈稿的要点整理成一份', acceptance: '10 条要点，每条能点回原话', state: 'offered', stage: 1,
    waiting: true, deadline: dueIn(now, 2, 12), createdAt: ago(now, 60 * MINUTE), updatedAt: ago(now, 60 * MINUTE) }));
}

function seedOthers(contacts: FakeContacts, now: Date): void {
  contacts.addPerson({ id: 'c_chenmo', name: '陈默', handle: 'chenmo', relation: 'friend' });
  contacts.seedMessage('c_chenmo', line('cm_chen_1', 'them', '这周哪天有空一起吃个饭？', ago(now, 26 * HOUR)));
  contacts.seedMessage('c_chenmo', line('cm_chen_2', 'my_ai', '周五下午有空', ago(now, 25 * HOUR)));
  contacts.addPerson({ id: 'c_ajie', name: '阿杰', handle: 'ajie', relation: 'partner' });
  contacts.seedMessage('c_ajie', line('cm_ajie_1', 'them', '报名页的文案能帮我写一下吗？', ago(now, 7 * DAY)));
  contacts.seedTask(task({ id: 'nt_ajie_signup', direction: 'in', contactId: 'c_ajie', title: '活动报名页文案',
    goal: '报名页的标题、介绍和三条报名须知', acceptance: '能直接贴进页面', state: 'passed', stage: 5, doer: 'person',
    createdAt: ago(now, 6 * DAY + HOUR), updatedAt: ago(now, 4 * DAY), version: 5,
    delivery: { text: '标题、介绍、三条须知都写好了。', at: ago(now, 5 * DAY) },
    verdict: { verdict: 'pass', note: '', at: ago(now, 4 * DAY) } }));
  contacts.addPerson({ id: 'c_xiaoman', name: '小满', handle: 'xiaoman', state: 'request', unread: 1 });
  contacts.seedMessage('c_xiaoman', line('cm_xiaoman_1', 'them',
    '你好，我是林一的朋友，想请你的 Plasticine 帮忙看一份简历。', ago(now, 30 * MINUTE)));
  contacts.directory.set('yuanye', '袁野');
  contacts.directory.set('momo', '默默');
}

const ALIYUN_EXPIRE_HTML = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5">'
  + '<tr><td style="padding:24px"><table width="560" align="center" style="background:#ffffff;border-radius:4px">'
  + '<tr><td style="background:#ff6a00;color:#ffffff;padding:16px 24px;font-size:18px">阿里云</td></tr>'
  + '<tr><td style="padding:24px;font-size:14px;line-height:22px;color:#333333">'
  + '<p>尊敬的用户：</p><p>您的云服务器 <b>ECS 实例</b>即将到期，到期后实例会停机。</p>'
  + '<p><a href="https://example.com/renew" style="display:inline-block;background:#ff6a00;color:#ffffff;'
  + 'padding:8px 16px;text-decoration:none">立即续费</a></p></td></tr>'
  + '<tr><td style="padding:16px 24px;font-size:12px;color:#999999">此邮件为系统邮件，请勿直接回复。</td></tr>'
  + '</table></td></tr></table>';

function seedInbox(inbox: FakeInbox, now: Date): void {
  const due = new Date(now.getTime() + 13 * DAY);
  const dueText = `${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  inbox.seed({ id: 'inbox_aliyun_bill', source: 'email', fromAddress: 'noreply@aliyun.com', fromName: '阿里云',
    title: '10 月账单已出', body: '您 10 月的账单已出，金额 ¥86.40。', receivedAt: ago(now, 10 * DAY), read: true });
  inbox.seed({ id: 'inbox_aliyun_expire', source: 'email', fromAddress: 'noreply@aliyun.com', fromName: '阿里云',
    title: `实例将于 ${dueText} 到期`,
    body: `您的云服务器 ECS 实例将于 ${dueText} 到期，到期后实例会停机。如需继续使用，请在到期前续费。`,
    receivedAt: ago(now, 3 * HOUR) });
  inbox.seed({ id: 'inbox_patrol_home', source: 'patrol', fromAddress: 'patrol', fromName: '巡查',
    title: '首页头条可以换成「等你」的第一条', body: '最近 7 天你打开首页后，先点的都是等你的那一条。',
    receivedAt: ago(now, 5 * HOUR), read: true });
  inbox.seed({ id: 'inbox_notice_backup', source: 'plasticine', fromAddress: 'plasticine', fromName: 'Plasticine',
    title: '本机备份做好了', body: '今天 03:00 的备份做好了，可以在「设置 · 系统」里按对象恢复。',
    receivedAt: ago(now, 2 * HOUR) });
  inbox.seed({ id: 'inbox_notice_patrol', source: 'plasticine', fromAddress: 'plasticine', fromName: 'Plasticine',
    title: '巡查找到 2 处可以改的地方', body: '都在联系人里的「巡查」。', receivedAt: ago(now, DAY), read: true });
}

const MATERIALS: readonly MaterialRow[] = [
  { kind: 'memory_topic', id: 'mt_about', title: '关于你', tier: 'private', proposed: null, version: 1 },
  { kind: 'memory_topic', id: 'mt_terms', title: '我的理论用词', tier: 'public', proposed: null, version: 1 },
  { kind: 'memory_topic', id: 'mt_reading', title: '阅读兴趣', tier: 'private', proposed: 'friend', version: 1 },
  { kind: 'memory_topic', id: 'mt_recent', title: '近况', tier: 'private', proposed: 'friend', version: 1 },
  { kind: 'project', id: 'p_plasticine', title: 'Plasticine', tier: 'partner', proposed: null, version: 1 },
  { kind: 'project', id: 'p_cyber_hunter', title: 'Cyber Hunter', tier: 'private', proposed: 'public', version: 1 },
  { kind: 'note', id: 'n_review_method', title: '商单复盘的做法', tier: 'public', proposed: null, version: 1 },
];

/** 第 12 批：记忆里的人物页。林一已经绑上；周可有一页同名的，资料栏会问是不是；老许删掉了，在「最近删除」。 */
function seedPeoplePages(contacts: FakeContacts, now: Date): void {
  contacts.personPages.push(
    { id: 'doc_person_lin', title: '林一', lines: [
      { text: '在做直播带货，主播是自己', by: '林一说的', at: ago(now, 2 * DAY) },
      { text: '周五下午一般有空', by: '你说的', at: ago(now, 4 * DAY) },
    ] },
    { id: 'doc_person_zhou', title: '周可', lines: [] },
    { id: 'doc_person_chen', title: '陈默', lines: [] },
  );
  const lin = contacts.people.get('c_linyi');
  if (lin !== undefined) lin.personDocId = 'doc_person_lin';
  contacts.addPerson({ id: 'c_laoxu', name: '老许', handle: 'laoxu', relation: 'stranger' });
  const xu = contacts.people.get('c_laoxu');
  if (xu !== undefined) xu.removedAt = ago(now, DAY);
}

export function seedContacts(parts: ContactsSeedParts, now: Date): void {
  seedLin(parts.contacts, now);
  seedZhou(parts.contacts, now);
  seedOthers(parts.contacts, now);
  seedPeoplePages(parts.contacts, now);
  seedInbox(parts.inbox, now);
  // 阿里云那封到期提醒有 HTML 正文（邮件按原样显示）：标题条、正文段落、按钮链接、页脚小字。
  parts.contacts.seedMailHtml('inbox_aliyun_expire', ALIYUN_EXPIRE_HTML);
  parts.network.seedJoined('alex', 'Alex');
  parts.visibility.seed(MATERIALS);
}
