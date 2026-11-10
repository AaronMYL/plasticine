import { createHash } from 'node:crypto';
import { ChangeSoulRequestSchema, SOUL_PATH, type SoulView } from '../../shared/api/soul.ts';
import { changeSoul, ensureRulesDoc, soulView } from '../brain/index.ts';
import { requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { sourcesOf } from './memory-sources.ts';
import { checkInput } from './validate.ts';

function view(context: RequestContext): SoulView {
  const { state } = context.deps;
  const result = soulView(state);
  return { ...result, lines: result.lines.map((line) => {
    const stored = state.memoryDocs.lines.require(line.id);
    return { ...line, sources: sourcesOf(state, stored.anchors).map((source) => ({ ...source,
      at: source.at === new Date(0).toISOString() ? line.at : source.at })) };
  }) };
}

export const SOUL_ROUTES: readonly Route[] = [
  { method: 'GET', path: SOUL_PATH, auth: true, handler(context) {
    requireAuth(context);
    ensureRulesDoc(context.deps.state);
    return { status: 200, body: view(context) };
  } },
  { method: 'POST', path: SOUL_PATH, auth: true, async handler(context) {
    const auth = requireUserAuth(context);
    const body = checkInput(ChangeSoulRequestSchema, await readJsonBody(context.req), '修改 Soul');
    return idempotent(context, body.requestId, () => {
      changeSoul(context.deps.state, body, { actor: 'user', ref: auth.device.id });
      return { status: 200, body: view(context) };
    }, { bodyDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') });
  } },
];
