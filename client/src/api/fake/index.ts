import { FakeSearch } from './fake-search.ts';
import { FakeSystems } from './fake-systems.ts';
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
import { FakeModelProviders } from './fake-model-providers.ts';
import { pieces } from './fake-line-script.ts';
import { lineSceneOf, seedLines } from './lines-seed.ts';
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
  contacts: FakeContacts;
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
  if (scene === 'tasks') {
    seedTasksLines(lines, now, deps.projectId);
    return;
  }
  if (scene === 'schedule') {
    seedScheduleScene(lines, (seed) => asks.raise(seed), now);
    return;
  }
  // ?scene=sample：研究周报样刊出来、附「开启定时 / 再改改」卡（第 7 批第 14 条，设计稿 Chat-Sample）。
  if (scene === 'sample') {
    seedSampleScene(lines, (seed) => asks.raise(seed), now);
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
      lines.resume(MAIN_LINE_ID, option === 'allow'
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
  const attachments = new FakeAttachments(session, now);
  const notes = new FakeNotes({ session, bus, faults, now });
  const lines = new FakeLines({ session, bus, receipts, now, stepMs: options.streamStepMs,
    note: (noteId) => notes.peek(noteId), feedItem: (id) => feed.find(id) });
  // 本地开发时导入书、生成大纲各等一会儿，看得到「正在导入」「正在逐章归纳」；测试（streamStepMs 0）不等。
  const books = new FakeBooks({ session, bus, notes, now, messages: () => lines.messagesOf(MAIN_LINE_ID),
    workMs: options.streamStepMs > 0 ? BOOK_WORK_MS : 0 });
  const asks = new FakeAsks({ session, bus, receipts, lines: () => lines, now });
  const clientUpdates = new FakeClientUpdates(session, bus);
  const backups = new FakeBackups({ session, bus, notes, asks, receipts, now });
  const push = new FakePush({ session, receipts, now });
  const agreements = new FakeAgreements({ session, bus, now });
  const memory = new FakeMemory({ session, bus, receipts, agreements, now });
  const deviceKeys = new FakeDeviceKeys({ session, faults, now });
  const projects = new FakeProjects({ session, bus, receipts, lines: () => lines.all(), now });
  const feed = new FakeFeed({ session, bus, receipts, now });
  const bookmarks = new FakeBookmarks({ session, receipts, now, projects: () => projects.names() });
  const webTabs = new FakeWebTabs({ session, receipts, bus });
  const today = new FakeToday({ session, receipts });
  const memoryTopics = new FakeMemoryTopics({ session, receipts, now });
  const spaces = new FakeSpaces({ session, receipts, now, dream: () => memoryTopics.currentDream() });
  const nodes = new FakeNodes({ session, bus, receipts, faults, now });
  const m5b = createFakeM5b({ session, bus, receipts, notes, now });
  const moneyDrafts = new FakeMoneyDrafts({ session, bus, receipts, now, attachments, asks, money: m5b.control.money });
  const signed = new FakeSigned({ session, receipts, agreements, asks, notes, backups, memoryTopics,
    nodes, faults, moneyDrafts });
  signed.setToolGroups(m5b.control.toolGroups);
  const systems = new FakeSystems(session);
  const contacts = new FakeContacts({ session, bus, receipts, inbox: m5b.control.inbox, now,
    replyMs: options.streamStepMs > 0 ? CONTACT_REPLY_MS : 0 });
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
    session.seedDevice('iPhone');
    session.seedDevice('Windows 笔记本');
    seedNotes(notes, now());
    seedBooks(books, lines, now());
    seedCognition({ memory, agreements }, now());
    seedDaily({ feed, projects }, now());
    seedBookmarks(bookmarks);
    webTabs.seed(demoWebTabsLayout(now()));
    webTabs.icons = true;
    memoryTopics.seed();
    spaces.seed();
    const netScene = netSceneOf(typeof window === 'undefined' ? '' : window.location.search);
    if (netScene === null) {
      seedContacts({ contacts, inbox: m5b.control.inbox, network, visibility }, now());
    } else {
      seedNetworkScene({ contacts, network }, now(), netScene);
    }
    const cyberHunter = projects.names().find((item) => item.name === 'Cyber Hunter')?.id ?? null;
    seedNewKernel({ lines, modelProviders, asks, contacts, projectId: cyberHunter }, now());
  }
  const api: PlasticineApi = {
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
