// /v2/memory/layers-move（shared/api/memory-layers.ts）：记忆分层的搬家记录——读最近一次搬了哪些，搬回去几条或全部。

import {
  MEMORY_LAYERS_MOVE_PATH, MEMORY_LAYERS_MOVE_UNDO_PATH, UndoLayersMoveRequestSchema, type LayersMoveResponse,
} from '../../shared/api/memory-layers.ts';
import { layersMoveView, undoLayersMove } from '../memory/index.ts';
import type { StateService } from '../state/index.ts';
import { requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function view(state: StateService, now: Date): LayersMoveResponse {
  const move = layersMoveView(state, now);
  return { move: move === null ? null : { at: move.at, kept: move.kept,
    items: move.items.map((item) => ({ lineId: item.line.id, text: item.line.text, toDocId: item.to.id,
      toTitle: item.to.title, section: item.line.section, fromTitle: item.from?.title ?? null })) } };
}

export const MEMORY_LAYERS_ROUTES: readonly Route[] = [
  { method: 'GET', path: MEMORY_LAYERS_MOVE_PATH, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: view(context.deps.state, context.deps.now()) };
  } },
  { method: 'POST', path: MEMORY_LAYERS_MOVE_UNDO_PATH, auth: true, async handler(context: RequestContext) {
    const auth = requireUserAuth(context);
    const body = checkInput(UndoLayersMoveRequestSchema, await readJsonBody(context.req), '把搬过的记忆搬回去');
    const { state, now } = context.deps;
    return idempotent(context, body.requestId, () => {
      undoLayersMove(state, body.lineIds ?? null, { actor: 'user', ref: auth.device.id }, now());
      return { status: 200, body: view(state, now()) };
    });
  } },
];
