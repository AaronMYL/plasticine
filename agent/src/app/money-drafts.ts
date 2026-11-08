import {
  CreateMoneyDraftRequestSchema,
  EditMoneyDraftRequestSchema,
  ConfirmMoneyDraftRequestSchema,
  RejectMoneyDraftRequestSchema,
  PurgeOriginalsRequestSchema,
  type PurgeOriginalsResponse,
} from '../../shared/api/index.ts';
import { param, requireAuth, type RequestContext, type Reply } from './context.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export function getMoneyDraft(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.moneyDrafts.view(param(context, 'id')) };
}
export async function createMoneyDraft(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(CreateMoneyDraftRequestSchema, raw.value, '识别付款截图');
  return idempotent(
    context,
    body.requestId,
    (after) => {
      const draft = context.deps.moneyDrafts.request(body, after);
      after(() => context.deps.paymentReader.start(draft.id));
      return { status: 202, body: draft };
    },
    { bodyDigest: raw.digest },
  );
}
export async function editMoneyDraft(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(EditMoneyDraftRequestSchema, raw.value, '核对记账草案');
  const id = param(context, 'id');
  return idempotent(
    context,
    body.requestId,
    (after) => {
      const draft = context.deps.moneyDrafts.propose(id, body.version, body.candidate, null, after);
      after(() => context.deps.paymentReader.cancel(id));
      return { status: 200, body: draft };
    },
    { bodyDigest: raw.digest },
  );
}
export async function confirmMoneyDraft(context: RequestContext): Promise<Reply> {
  return confirmedWrite(
    context,
    (value) => checkInput(ConfirmMoneyDraftRequestSchema, value, '确认记账'),
    (body, proof, after) => ({
      status: 200,
      body: context.deps.moneyDrafts.confirm(param(context, 'id'), body, proof, after),
    }),
  );
}
export async function rejectMoneyDraft(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RejectMoneyDraftRequestSchema, raw.value, '不记这笔');
  const id = param(context, 'id');
  return idempotent(
    context,
    body.requestId,
    (after) => {
      const draft = context.deps.moneyDrafts.reject(id, body.version, body.askVersion, auth.device.id, after);
      after(() => context.deps.paymentReader.cancel(id));
      return { status: 200, body: draft };
    },
    { bodyDigest: raw.digest },
  );
}

/** GET /v2/money/drafts/summary：每周汇总（第二批「记账直接记」）。 */
export function getMoneyDraftSummary(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.moneyDrafts.weekSummary() };
}

/** POST /v2/money/drafts/originals/purge：你点「清掉原图」，已记账截图的原图删掉，账目不动。 */
export async function purgeMoneyOriginals(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(PurgeOriginalsRequestSchema, await readJsonBody(context.req), '清掉原图');
  return idempotent(context, body.requestId, (after) => {
    const response: PurgeOriginalsResponse = { purged: context.deps.moneyDrafts.purgeOriginals(after) };
    return { status: 200, body: response };
  });
}
