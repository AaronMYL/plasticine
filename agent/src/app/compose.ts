// 预测消息（11-13 Aaron 定）：POST /v2/compose/predict（流式）和 /v2/compose/outcome。界面只发这是哪段对话和草稿；
// 这里按那条线 / 那段聊天现读最近的消息，交给 ComposePredictor 猜。来信（邮箱）不猜；线不在、联系人不在照常 404。

import {
  ComposeOutcomeSchema, ComposePredictRequestSchema, type ComposePredictView, type ComposeTarget,
} from '../../shared/api/index.ts';
import { COMPOSE_TURNS, type ComposeContext, type ComposeTurn } from '../brain/compose-predictor.ts';
import { notFoundError } from './api-error.ts';
import { parseInboxContact } from './contact-mail.ts';
import { personThread } from './contact-views.ts';
import { requireAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { groupThread } from './group-views.ts';
import { isGroupId, requireGroupRow } from './groups.ts';
import { readJsonBody } from './http.ts';
import { kernel } from './lines.ts';
import { streamReply } from './sse-reply.ts';
import { checkInput } from './validate.ts';

/** 线在忙（在跑、排着队）时不算轮到他。 */
const BUSY = new Set(['running', 'queued']);
const LINE_READ = COMPOSE_TURNS * 3;

function lineContext(context: RequestContext, id: string): ComposeContext {
  const page = kernel(context).read(id, LINE_READ);
  const name = page.line.title === '' ? 'Plasticine' : page.line.title;
  const turns = page.messages.flatMap((message): ComposeTurn[] => {
    if (message.text.trim() === '') return [];
    // 他自己打的那句（不是定时、委托、系统送进来的）：用他的原话，不用展开了引用的那一版。
    if (message.role === 'user' && message.origin?.kind === 'user') {
      return [{ who: 'me', name: '他', text: message.origin.userText ?? message.text }];
    }
    if (message.role === 'assistant') return [{ who: 'other', name, text: message.text }];
    // 后台线做完回来的汇报：主线上他最后看到的常常就是这一条，算 Plasticine 说的。
    if (message.role === 'lineReport') return [{ who: 'other', name, text: message.text }];
    return [];
  });
  const myTurn = turns.at(-1)?.who === 'other' && !BUSY.has(page.line.status) && page.queue.length === 0;
  return { with: name, turns, myTurn };
}

function contactContext(context: RequestContext, id: string): ComposeContext | null {
  const { state } = context.deps;
  if (parseInboxContact(id) !== null) {
    return null;
  }
  const group = isGroupId(id) ? requireGroupRow(context.deps, id) : null;
  const person = group === null ? state.contacts.get(id) : undefined;
  if (group === null && person === undefined) {
    throw notFoundError('这个联系人');
  }
  const items = group === null ? personThread(state, id, undefined).items : groupThread(state, id, undefined).items;
  const other = group === null ? (person?.alias ?? person?.displayName ?? '对方') : '群里的人';
  const turns = items.flatMap((item): ComposeTurn[] => {
    if (item.type !== 'message' || item.message.text.trim() === '' || item.message.author === 'system') return [];
    const { message } = item;
    const mine = message.author === 'me' || message.author === 'my_ai';
    const name = message.sender?.name ?? (message.author === 'their_ai' ? `${other}的 Plasticine` : other);
    return [{ who: mine ? 'me' : 'other', name, text: message.text }];
  });
  return { with: group === null ? other : `群组「${group.name}」`, turns, myTurn: turns.at(-1)?.who === 'other' };
}

function contextOf(context: RequestContext, target: ComposeTarget): ComposeContext | null {
  return target.kind === 'line' ? lineContext(context, target.id) : contactContext(context, target.id);
}

/** POST /v2/compose/predict：边生成边送；没轮到他说、来信这类不猜的，直接 done 一个空的。 */
export async function predictCompose(context: RequestContext): Promise<HandlerResult> {
  requireAuth(context);
  const input = checkInput(ComposePredictRequestSchema, await readJsonBody(context.req), '输入建议');
  const talk = contextOf(context, input.target);
  return streamReply<ComposePredictView>(context, (signal, onText) => talk === null
    ? Promise.resolve({ text: '' }) : context.deps.composePredictor.predict(input.draft, talk, signal, onText));
}

/** POST /v2/compose/outcome：采纳了还是没要。报过的不再改；记录不在也不算错。 */
export async function composeOutcome(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(ComposeOutcomeSchema, await readJsonBody(context.req), '输入建议的结果');
  return { status: 200, body: { resolved: context.deps.state.loop.resolveById('message_predict', input.loopId,
    input.outcome) } };
}
