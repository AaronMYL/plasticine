import { FakeMates } from './fake-mates.ts';
import { FakeSoul } from './fake-soul.ts';
import { seedMemoryScene } from './memory-scene-seed.ts';
import { inferSoulSection, ruleTexts } from '../../../../agent/shared/soul.ts';
import { renderBookPage } from '../../../../agent/shared/book-space-page.ts';
import { renderWebArchive } from '../../../../agent/shared/web-archive-page.ts';
import { renderVideoPage } from '../../../../agent/shared/video-space-page.ts';
import { seedNetworkAttachmentScene } from './network-attachments-seed.ts';
import { FakeNetworkAttachments } from './fake-network-attachments.ts';
import { FakeSearch } from './fake-search.ts';
import { FakeSystems } from './fake-systems.ts';
import { FakeOutbound } from './fake-outbound.ts';
// 内存里的假接口：给测试和 `npm run dev` 用。行为照《实施方案》第 5 节的四条约定做（幂等、回执不确定、
// 错误格式、401 事件），请求和回答的形状是 shared/api 的，这样界面在假实现上测过的状态，接真服务端时还成立。
// 本人确认写操作核实配对会话，系统会话不能冒充本人；旧钥匙接口只作兼容。
// 2026-11-05 Harness 重做：对话走线（fake-lines.ts），任务、关切、判断、≠、自迭代、事、今日汇报、启用、度量的假实现删了。

import { FakeTranslate } from './fake-translate.ts';
import type { PlasticineApi } from '../client.ts';
import { FakeMoneyDrafts } from './fake-money-drafts.ts';
import { FakeClientUpdates } from './fake-client-updates.ts';
import { FakeBackups } from './fake-backups.ts';
import { seedCognition } from './cognition-seed.ts';
import { seedDaily } from './daily-seed.ts';
import { FakeEventBus } from './event-bus.ts';
import { FakeAgreements } from './fake-agreements.ts';
import { FakeAttachments } from './fake-attachments.ts';
import { FakeBooks } from './fake-books.ts';
import { seedBooks } from './seed-books.ts';
import { FakeAsks } from './fake-asks.ts';
import { FakeProjects } from './fake-projects.ts';
import { FakeDeviceKeys } from './fake-device-keys.ts';
import { FakeFeed } from './fake-feed.ts';
import { FakeMemory } from './fake-memory.ts';
import { FakeNodes } from './fake-nodes.ts';
import { FakeNotes } from './fake-notes.ts';
import { FakePush } from './fake-push.ts';
import { FakeSession } from './fake-session.ts';
import { FakeAccount } from './fake-account.ts';
import { FakeSigned } from './fake-signed.ts';
import { FakeToday } from './fake-today.ts';
import { FakeMemoryTopics } from './fake-memory-topics.ts';
import { FakeSpaces } from './fake-spaces.ts';
import { createFakeLibrary } from './fake-library.ts';
import { FaultPlan } from './faults.ts';
import { createFakeM5b, seedM5b, type FakeM5bControl } from './fake-m5b.ts';
import { FakeReceipts } from './receipts.ts';
import { seedNotes } from './seed.ts';
import { FakeBookmarks } from './fake-bookmarks.ts';
import { seedBookmarks } from './bookmarks-seed.ts';
import { FakeWebTabs } from './fake-web-tabs.ts';
import { demoWebTabsLayout } from './tabs-seed.ts';
import { seedContacts } from './contacts-seed.ts';
import { netSceneOf, seedNetworkScene } from './network-seed.ts';
import { FakeContacts } from './fake-contacts.ts';
import { FakeNetwork, FakeVisibility } from './fake-network.ts';
import { FakeNetworkTasks } from './fake-network-tasks.ts';
import { FakeLines, MAIN_LINE_ID } from './fake-lines.ts';
import { FakeTasks } from './fake-tasks.ts';
import { seedSampleScene, seedScheduleScene, seedTasks, seedTasksLines } from './tasks-seed.ts';
import { seedOutboundScene } from './outbound-seed.ts';
import { FakeModelProviders } from './fake-model-providers.ts';
import { pieces } from './fake-line-script.ts';
import { lineSceneOf, seedLines } from './lines-seed.ts';
import { seedLetterScene } from './letter-seed.ts';
import { seedPageScene } from './page-seed.ts';
import { seedWorkScene, workSceneOf } from './work-seed.ts';

/** 本地开发里导入一本书、生成一次大纲要等多久（毫秒）：够看清进行中的样子，又不拖。 */
const BOOK_WORK_MS = 1_500;
/** 本地开发里联系人那边的 Plasticine 过多久回一句、接任务（毫秒）：看得到对方在动，又不用等。 */
const CONTACT_REPLY_MS = 2_500;

export interface FakeApiOptions {
  /** 预置会话、线、笔记、记忆、项目和信息流示例（本地开发）；测试一般不要。 */
  seed: boolean;
  /** 流式片段间隔，毫秒；测试用 0。 */
  streamStepMs: number;
  now?: () => Date;
}

export interface FakeControl {
  mates: FakeMates;
  /** 记忆里的「规则」和说法冲突（11-11）。 */
  soul: FakeSoul;
  outbound: FakeOutbound;
  networkAttachments: FakeNetworkAttachments;
  /** 新内核（2026-11-05）：线和模型连接。 */
  lines: FakeLines;
  /** 任务栏目（《优化清单》第 3、4、5 条）。 */
  tasks: FakeTasks;
  modelProviders: FakeModelProviders;
  clientUpdates: FakeClientUpdates;
  backups: FakeBackups;
  attachments: FakeAttachments;
  session: FakeSession;
  /** 11-08 首次使用流程：建账号、密码登录。 */
  account: FakeAccount;
  notes: FakeNotes;
  books: FakeBooks;
  asks: FakeAsks;
  push: FakePush;
  memory: FakeMemory;
  agreements: FakeAgreements;
  deviceKeys: FakeDeviceKeys;
  projects: FakeProjects;
  /** 第 110 条：书签（2026-11-04 起和信息流收藏分开）。 */
  bookmarks: FakeBookmarks;
  /** 11-08：竖排标签存在本体里。 */
  webTabs: FakeWebTabs;
  today: FakeToday;
  systems: FakeSystems;
  memoryTopics: FakeMemoryTopics;
  /** 第 6、7 条：空间与订阅。 */
  spaces: FakeSpaces;
  feed: FakeFeed;
  nodes: FakeNodes;
  bus: FakeEventBus;
  faults: FaultPlan;
  /** M5 乙路：记账、站内信、工具组、文件、浏览器、技能。 */
  m5b: FakeM5bControl;
  /** 付款截图记账草案（第二批：每周汇总的种子）。 */
  moneyDrafts: FakeMoneyDrafts;
  /** 第 113 条：联系人、跨用户任务、网络账号、对外可见。 */
  contacts: FakeContacts;
  network: FakeNetwork;
  visibility: FakeVisibility;
}

export interface FakeApi {
  api: PlasticineApi;
  control: FakeControl;
}

/** 本地开发的线和模型连接：场景看地址里的 ?scene=（lines-seed.ts）；硬线卡答了，主对话接着跑。 */
function seedNewKernel(deps: { lines: FakeLines; modelProviders: FakeModelProviders; asks: FakeAsks;
  contacts: FakeContacts; outbound: FakeOutbound; attachments: FakeAttachments;
  projectId: string | null }, now: Date): void {
  const { lines, modelProviders, asks } = deps;
  const search = typeof window === 'undefined' ? '' : window.location.search;
  // ?net=connect：新装、一家模型都没连（第一次打开的第一步）。
  if (netSceneOf(search) !== 'connect') {
    modelProviders.seedConnected([['openai', 'oauth'], ['anthropic', 'api_key'], ['deepseek', 'api_key']],
      { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
    modelProviders.seedConfig([{ provider: 'openai', models: ['gpt-5.5', 'gpt-5.5-mini'] },
      { provider: 'anthropic', models: ['claude-sonnet-5', 'claude-haiku-5'] },
      { provider: 'deepseek', models: ['deepseek-v4'] }], {
      agent: { model: null, thinking: 'medium' },
      dream: { model: { provider: 'anthropic', model: 'claude-haiku-5' }, thinking: 'medium' },
      translation: { model: { provider: 'deepseek', model: 'deepseek-v4' }, thinking: null },
    });
  }
  // ?scene=tasks：任务栏目稿子里的在做和刚做完；?scene=schedule：主线里那张抖音续火花的定时卡。
  const scene = new URLSearchParams(search).get('scene');
  if (scene === 'outbound') {
    deps.contacts.addPerson({ id: 'contact-fern', name: '小蕨', handle: 'fern-example' });
    deps.contacts.addPerson({ id: 'contact-river', name: '河川', handle: 'river-example' });
    seedOutboundScene(lines, deps.outbound, (seed) => asks.raise(seed), now);
    return;
  }
  if (scene === 'tasks') {
    seedTasksLines(lines, now, deps.projectId);
    return;
  }
  if (scene === 'schedule') {
    seedScheduleScene(lines, (seed) => asks.raise(seed), now);
    return;
  }
  // ?scene=reply：周可问了我的 Plasticine，它拿不准，确认卡出在和周可的聊天里（11-12 全量优化第 5 条）。
  if (scene === 'reply') {
    asks.raise({ id: 'ask_reply_zhou', kind: 'confirm', basis: 'inferred',
      question: '周可 @zhouke 问你的 Plasticine：3 份访谈稿整理成要点，能接吗？',
      detail: '原问题：3 份访谈稿整理成要点，能接吗？\n\n想这样回：能接。稿子发来后，周五前给你 10 条要点，每条都能点回原话。',
      options: [{ id: 'send', label: '这样回', description: null, recommended: true },
        { id: 'self', label: '我自己回', description: null, recommended: false },
        { id: 'none', label: '不回', description: null, recommended: false }],
      networkReply: { contactId: 'c_zhouke', groupId: null, questionId: 'q_zhou_1',
        draft: '能接。稿子发来后，周五前给你 10 条要点，每条都能点回原话。' } });
    // 我在群里 @ 了自己的 Plasticine、它想先给我看一眼（11-13；群在 ?net=alex / ?net=group 里才有）。
    asks.raise({ id: 'ask_reply_self', kind: 'confirm', basis: 'inferred',
      question: '你让 Plasticine 在「杭州周末」里回一句：帮我回阿杰，茶社我订',
      detail: '你说的：帮我回阿杰，茶社我订\n\n想这样发：茶社我来订，周六四点的位子，到了报 Alex。',
      options: [{ id: 'send', label: '这样发', description: null, recommended: true },
        { id: 'none', label: '不发', description: null, recommended: false }],
      networkReply: { contactId: null, groupId: 'grp-hangzhou', questionId: 'q_self_1',
        draft: '茶社我来订，周六四点的位子，到了报 Alex。', self: true } });
    return;
  }
  // ?scene=sample：研究周报样刊出来、附「开启定时 / 再改改」卡（第 7 批第 14 条，设计稿 Chat-Sample）。
  if (scene === 'sample') {
    seedSampleScene(lines, (seed) => asks.raise(seed), now);
    return;
  }
  // ?scene=page：开着「问这一页」发出去的一句，带网页结构和截图（11-13 快照卡）。
  if (scene === 'page') {
    seedPageScene(lines, deps.attachments, now);
    return;
  }
  // ?scene=letter：早上收到的来信（第 8 批第 6 条，设计稿 Chat-Letter）。
  if (scene === 'letter') {
    seedLetterScene(lines, now);
    return;
  }
  const workScene = workSceneOf(search);
  if (workScene !== null) {
    seedWorkScene(deps, now, workScene);
    return;
  }
  seedLines({ lines, projectId: deps.projectId, raiseAsk: (seed) => {
    asks.raise(seed);
    asks.onAnswer(seed.id, (option) => {
      lines.resumeWith(MAIN_LINE_ID, option === 'allow'
        ? { thinking: [], steps: [{ tool: 'mail_send', say: '发出回复', result: '已发出' }], answer: pieces('发出去了。') }
        : { thinking: [], steps: [], answer: pieces('好，先不发。') });
    });
  } }, now, lineSceneOf(search));
}

export function createFakeApi(options: FakeApiOptions): FakeApi {
  const now = options.now ?? ((): Date => new Date());
  const bus = new FakeEventBus();
  const faults = new FaultPlan();
  const session = new FakeSession(now);
  const receipts = new FakeReceipts(faults, () => session.currentSession()?.device.id ?? null);
  const outbound = new FakeOutbound(session, receipts, now);
  const attachments = new FakeAttachments(session, now);
  const notes = new FakeNotes({ session, bus, faults, now });
  const lines = new FakeLines({ session, bus, receipts, now, stepMs: options.streamStepMs,
    note: (noteId) => notes.peek(noteId), feedItem: (id) => feed.find(id) });
  let addMateRules: (mateId: string, text: string) => void = () => undefined;
  const mates = new FakeMates({ session, lines, receipts, now, rules: (id, text) => addMateRules(id, text) });
  // 本地开发时导入书、生成大纲各等一会儿，看得到「正在导入」「正在逐章归纳」；测试（streamStepMs 0）不等。
  const books = new FakeBooks({ session, bus, notes, now, messages: () => lines.messagesOf(MAIN_LINE_ID),
    workMs: options.streamStepMs > 0 ? BOOK_WORK_MS : 0,
    publishInsight: (book, insight, rewrite) => spaces.ensureGenerated({ id: `space-${book.id}-${insight.kind}`,
      title: `${book.title} · ${insight.kind === 'outline' ? '大纲' : '重点'}`, category: 'booknote',
      bookId: book.id, sourceUrl: `book:${book.id}:${insight.kind}`,
      html: renderBookPage({ bookId: book.id, toc: book.toc, currentChapter: book.progress?.chapter ?? null,
        dismissedPointIds: insight.dismissedPointIds,
        ...(insight.outline === null ? {} : { outline: insight.outline, marks: books.marksOf(book.id) }),
        ...(insight.keyPoints === null ? {} : { keyPoints: insight.keyPoints }) }) }, rewrite) });
  const asks = new FakeAsks({ session, bus, receipts, lines: () => lines, now,
    authorize: (card, selected, option) => outbound.authorize(card, selected, option) });
  const clientUpdates = new FakeClientUpdates(session, bus);
  const backups = new FakeBackups({ session, bus, notes, asks, receipts, now });
  const push = new FakePush({ session, receipts, now });
  const agreements = new FakeAgreements({ session, bus, now });
  const memory = new FakeMemory({ session, bus, receipts, agreements, now });
  const deviceKeys = new FakeDeviceKeys({ session, faults, now });
  const projects = new FakeProjects({ session, bus, receipts, lines: () => lines.all(), now });
  const feed = new FakeFeed({ session, bus, receipts, now,
    publishWork: (work) => spaces.ensureGenerated({ id: `space-${work.id}`, title: work.title,
      category: 'report', sourceUrl: work.url, bookId: null,
      html: renderVideoPage({ ...work, collectSeq: 1, transcript: '[00:00] 定投需要稳定的节奏。\n[00:30] 留意回撤和风险。',
        digest: { summary: '稳定地投入，比猜准下一次涨跌更重要。',
          outline: ['[00:00] 为什么要定投', '[00:30] 回撤与风险', '[01:20] 保持节奏'],
          points: ['先了解自己能承受的回撤。', '不要因为短期波动频繁改变计划。'],
          related: ['可以把执行记录和每月计划放在一起。'] } }) }) });
  const bookmarks = new FakeBookmarks({ session, receipts, now, bus, projects: () => projects.names() });
  const webTabs = new FakeWebTabs({ session, receipts, bus });
  const today = new FakeToday({ session, receipts });
  const memoryTopics = new FakeMemoryTopics({ session, receipts, now });
  const soul = new FakeSoul(session, receipts, now, (view) => memoryTopics.applySoul(view));
  addMateRules = (mateId, text) => soul.seedLines(ruleTexts(text).map((rule, index) => ({
    id: `soul-mate-${mateId}-${index}`, text: rule, section: inferSoulSection(rule), source: 'mate',
    scopeKind: 'mate', scopeRef: mateId })));
  const spaces = new FakeSpaces({ session, receipts, now, bus, dream: () => memoryTopics.currentDream() });
  const nodes = new FakeNodes({ session, bus, receipts, faults, now });
  const m5b = createFakeM5b({ session, bus, receipts, notes, now });
  m5b.control.browser.setArchive(async (page) => {
    const existing = spaces.findBySourceUrl(page.url, 'webarchive');
    if (existing?.deletedAt != null) throw new Error('这个网址的归档已删除，请先恢复。');
    const id = spaces.ensureGenerated({ id: existing?.id ?? `web-${encodeURIComponent(page.url)}`,
      title: page.title, category: 'webarchive', sourceUrl: page.url, bookId: null,
      html: renderWebArchive(page, [], now()) }, true);
    return { space: await spaces.spaces.get(id) };
  });
  const moneyDrafts = new FakeMoneyDrafts({ session, bus, receipts, now, attachments, asks, money: m5b.control.money });
  const signed = new FakeSigned({ session, receipts, agreements, asks, notes, backups, memoryTopics,
    nodes, faults, moneyDrafts });
  signed.setToolGroups(m5b.control.toolGroups);
  const systems = new FakeSystems(session);
  const networkAttachments = new FakeNetworkAttachments(session, receipts,
    (thread, message) => contacts.retryMessage(thread, message));
  const contacts = new FakeContacts({ session, bus, receipts, inbox: m5b.control.inbox, now,
    replyMs: options.streamStepMs > 0 ? CONTACT_REPLY_MS : 0,
    attachments: (ids, thread, message) => networkAttachments.bind(ids, thread, message) });
  const networkTasks = new FakeNetworkTasks({ session, receipts, contacts, lines, now });
  const network = new FakeNetwork({ session, receipts, now });
  const account = new FakeAccount({ session, network, lines: () => lines, now });
  const visibility = new FakeVisibility({ session, receipts, relationCounts: () => contacts.relationCounts(),
    marked: (row) => memoryTopics.applyTier(row.kind === 'project' ? 'project' : 'memory_topic', row.id, row.tier,
      row.version) });
  const modelProviders = new FakeModelProviders(session);
  const tasks = new FakeTasks({ session, bus, receipts, lines, asks, projects: () => projects.names() });
  if (options.seed) {
    seedTasks(tasks, now());
    today.seedCalendar(now());
    // ?scene=calendar-mac：配了一台只给了日历、没给提醒事项的 Mac（设置 · 系统「日历和提醒事项」那一行）。
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('scene') === 'calendar-mac') {
      nodes.addNode('家里的 Mac', ['file_list', 'file_read', 'calendar_list', 'calendar_create']);
    }
    seedM5b(m5b.control, now());
    // 第二批「记账直接记」：这周四张付款截图直接入账，新商户那笔标「待你看一眼」。
    const hours = (count: number) => new Date(now().getTime() - count * 3_600_000).toISOString();
    m5b.control.money.seed({ id: 'pay_demo_1', amountCents: 2800, merchant: '楼下面馆', categoryId: 'food',
      occurredAt: hours(5), origin: 'ai' });
    m5b.control.money.seed({ id: 'pay_demo_2', amountCents: 4590, merchant: '盒马', categoryId: 'daily',
      occurredAt: hours(30), origin: 'ai' });
    m5b.control.money.seed({ id: 'pay_demo_3', amountCents: 1600, merchant: '滴滴出行', categoryId: 'traffic',
      occurredAt: hours(52), origin: 'ai' });
    m5b.control.money.seed({ id: 'pay_demo_4', amountCents: 12800, merchant: '一间新开的书店', categoryId: 'study',
      occurredAt: hours(76), origin: 'ai', review: true });
    moneyDrafts.seedWeek(4, 1);
    session.signInForDevelopment('本地开发');
    // 设置 · 账号「登录着的设备」：另外两台用 @账号和密码登录着（11-08 设计稿 Settings-Account）。
    session.seedDevice('iPhone', 'direct');
    session.seedDevice('Windows 笔记本', 'relay');
    seedNotes(notes, now());
    seedBooks(books, lines, now());
    seedCognition({ memory, agreements }, now());
    seedDaily({ feed, projects }, now());
    seedBookmarks(bookmarks);
    webTabs.seed(demoWebTabsLayout(now()));
    webTabs.icons = true;
    memoryTopics.seed();
    // ?scene=memory：两位队友各有只对它的规则，外加一处说法冲突（11-11 第二步截图用）。
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('scene') === 'memory') {
      seedMemoryScene({ mates, soul }, now());
    }
    spaces.seed();
    const netScene = netSceneOf(typeof window === 'undefined' ? '' : window.location.search);
    if (netScene === null) {
      seedContacts({ contacts, inbox: m5b.control.inbox, network, visibility }, now());
    } else {
      seedNetworkScene({ contacts, network }, now(), netScene);
    }
    const cyberHunter = projects.names().find((item) => item.name === 'Cyber Hunter')?.id ?? null;
    seedNewKernel({ lines, modelProviders, asks, contacts, outbound, attachments, projectId: cyberHunter }, now());
    if (typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('scene') === 'network-attachments') {
      seedNetworkAttachmentScene(contacts, networkAttachments, now());
    }
  }
  const api: PlasticineApi = {
    mates, mateGroups: mates.groups, soul, outbound, networkAttachments,
    lines,
    tasks,
    modelProviders,
    search: new FakeSearch({ session, notes, lines, memoryTopics, agreements, feed, bookmarks, now, spaces, books }),
    systems,
    translate: new FakeTranslate(session, modelProviders),
    session,
    account,
    devices: session,
    notes,
    books,
    asks,
    push,
    memory,
    attachments,
    links: { preview: async (address) => {
      session.require();
      const url = new URL(address);
      return { url: url.href, site: url.hostname, title: url.hostname, description: '', image: null };
    } },
    moneyDrafts,
    clientUpdates,
    backups,
    agreements,
    deviceKeys,
    signed,
    projects,
    bookmarks,
    webTabs,
    today,
    memoryTopics,
    spaces: spaces.spaces,
    subscriptions: spaces.subscriptions,
    library: createFakeLibrary({ session, spaces, books, files: m5b.control.files }),
    feed,
    nodes,
    ...m5b.api,
    contacts,
    networkTasks,
    groupTasks: contacts.groupChats,
    network,
    visibility,
    events: bus,
    onUnauthorized: (listener) => session.onUnauthorized(listener),
  };
  return {
    api,
    control: {
      mates, soul, outbound, networkAttachments,
      lines,
      tasks,
      modelProviders,
      moneyDrafts,
      clientUpdates,
      backups,
      attachments,
      session,
      account,
      notes,
      books,
      asks,
      push,
      memory,
      agreements,
      deviceKeys,
      projects,
      bookmarks,
      webTabs,
      today,
      systems,
      memoryTopics,
      spaces,
      feed,
      nodes,
      bus,
      faults,
      m5b: m5b.control,
      contacts,
      network,
      visibility,
    },
  };
}
