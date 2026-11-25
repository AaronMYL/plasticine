import { HomeQuerySchema, type HomeCard, type HomeResponse } from '../../shared/api/index.ts';
import type { Ask } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import { requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { todayNumbers } from './today.ts';
import { checkInput, queryObject } from './validate.ts';

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const PINNED_SCORE = { urgency: 1, relevance: 1, freshness: 1, reaction: 1, total: 1 };

function askAction(ask: Ask): string {
  if (ask.purpose === 'network_reply' || ask.purpose === 'network_task') {
    return '回复';
  }
  if (ask.kind === 'approve') {
    return '授权';
  }
  return ask.kind === 'act' ? '去做' : '去定';
}

function askAvatar(deps: AppDeps, ask: Ask): string | null {
  const context = ask.context ?? {};
  let contactId = typeof context['contactId'] === 'string' ? context['contactId'] : null;
  if (contactId === null && typeof context['networkTaskId'] === 'string') {
    contactId = deps.state.networkTasks.get(context['networkTaskId'])?.contactId ?? null;
  }
  const name = contactId === null ? '' : deps.state.contacts.get(contactId)?.displayName.trim() ?? '';
  return name === '' ? null : Array.from(name)[0] ?? null;
}

function askCard(deps: AppDeps, ask: Ask): HomeCard {
  return {
    id: `ask:${ask.id}`,
    kind: 'decide',
    kindLabel: '等你定',
    layer: 'pinned',
    title: ask.question,
    detail: ask.detail,
    reason: null,
    why: '有一张卡等你定',
    score: PINNED_SCORE,
    project: null,
    target: { kind: 'ask', ref: ask.id },
    actionLabel: askAction(ask),
    meta: null,
    progress: null,
    avatar: askAvatar(deps, ask),
    observations: [],
    updatedAt: ask.updatedAt,
  };
}

/** GET /v2/home?tz=&device= */
export function getHome(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(HomeQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const { deps } = context;
  const now = deps.now();
  const timeZone = query.tz ?? DEFAULT_TIME_ZONE;
  const day = localDay(now, timeZone);
  const pinned = deps.state.asks.open()
    .filter((ask) => ask.deferredAt === null && ask.channel !== 'next_report')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((ask) => askCard(deps, ask));
  const body: HomeResponse = {
    date: day,
    timeZone,
    device: query.device ?? 'desktop',
    generatedAt: now.toISOString(),
    pinned,
    now: [],
    rest: [],
    pinnedMore: 0,
    quieter: [],
    returnBrief: null,
    numbers: todayNumbers(deps, day, timeZone),
    changes: [],
  };
  return { status: 200, body };
}
