import { createHash } from 'node:crypto';
import { CreateMateGroupRequestSchema, CreateMateRequestSchema, LegacyChatConvertRequestSchema,
  LegacyChatPrepareRequestSchema, MateHandoffRequestSchema, UpdateMateGroupRequestSchema,
  UpdateMateRequestSchema, MATES_PATH, MATE_GROUPS_PATH } from '../../shared/api/mates.ts';
import { Mates } from '../mates/service.ts';
import { param, requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { lineCall } from './lines.ts';
import { checkInput } from './validate.ts';

export function matesFor(context: RequestContext): Mates {
  return new Mates(context.deps.state, () => context.deps.lines);
}
function digest(value: unknown) {
  return { bodyDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

export const MATE_ROUTES: readonly Route[] = [
  { method: 'GET', path: MATES_PATH, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: matesFor(context).list() };
  } },
  { method: 'POST', path: MATES_PATH, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(CreateMateRequestSchema, await readJsonBody(context.req), '队友');
    const { requestId, ...draft } = input;
    return idempotent(context, requestId, (after) => ({ status: 201,
      body: lineCall(() => matesFor(context).create(draft, after)) }), digest(input));
  } },
  { method: 'POST', path: `${MATES_PATH}/handoff`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(MateHandoffRequestSchema, await readJsonBody(context.req), '交接');
    return idempotent(context, input.requestId, (after) => ({ status: 200,
      body: { line: lineCall(() => matesFor(context).handoff(input, after)) } }), digest(input));
  } },
  { method: 'POST', path: `${MATES_PATH}/legacy/prepare`, auth: true, async handler(context) {
    requireAuth(context);
    const input = checkInput(LegacyChatPrepareRequestSchema, await readJsonBody(context.req), '旧对话');
    return { status: 200, body: await matesFor(context).prepare(input.lineId, context.deps.text,
      AbortSignal.timeout(90_000)).catch((error: unknown) => lineCall(() => { throw error; })) };
  } },
  { method: 'POST', path: `${MATES_PATH}/legacy/convert`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(LegacyChatConvertRequestSchema, await readJsonBody(context.req), '旧对话转换');
    return idempotent(context, input.requestId, (after) => ({ status: 200,
      body: lineCall(() => matesFor(context).convert(input, after)) }), digest(input));
  } },
  { method: 'GET', path: `${MATES_PATH}/:id`, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: context.deps.state.mates.require(param(context, 'id')) };
  } },
  { method: 'PATCH', path: `${MATES_PATH}/:id`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(UpdateMateRequestSchema, await readJsonBody(context.req), '队友');
    const { requestId, ...patch } = input;
    return idempotent(context, requestId, (after) => ({ status: 200,
      body: matesFor(context).update(param(context, 'id'), patch, after) }), digest(input));
  } },
  { method: 'GET', path: MATE_GROUPS_PATH, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: { groups: context.deps.state.mateGroups.all() } };
  } },
  { method: 'POST', path: MATE_GROUPS_PATH, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(CreateMateGroupRequestSchema, await readJsonBody(context.req), '队友群组');
    const { requestId, ...draft } = input;
    return idempotent(context, requestId, (after) => ({ status: 201,
      body: lineCall(() => matesFor(context).createGroup(draft, after)) }), digest(input));
  } },
  { method: 'PATCH', path: `${MATE_GROUPS_PATH}/:id`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(UpdateMateGroupRequestSchema, await readJsonBody(context.req), '队友群组');
    const { requestId, version, ...patch } = input;
    return idempotent(context, requestId, (after) => {
      const group = context.deps.state.mateGroups.update(param(context, 'id'), version, patch);
      context.deps.state.lines.update(group.lineId, { title: group.name });
      context.deps.lines.changed(group.lineId, after);
      return { status: 200, body: group };
    }, digest(input));
  } },
];
