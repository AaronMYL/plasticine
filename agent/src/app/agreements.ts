// /v2/agreements: the 约定 column (newest first), one agreement with its history, and the user's
// confirmation — the only way an agreement takes effect or is revoked (from the paired user session). A
// migrated agreement already in effect keeps its effective time when confirmed; one waiting 待议 takes effect now.
// The ordinary write path (state/agreements.ts) can only move an agreement back to 待议, never forward.

import {
  AgreementListQuerySchema,
  COGNITION_PAGE_DEFAULT,
  ConfirmAgreementRequestSchema,
  EditAgreementRequestSchema,
  type AgreementDetail,
  type AgreementListResponse,
  type AgreementResponse,
} from '../../shared/api/index.ts';
import type { Agreement, AgreementConfirmed } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { agreementView, changeRecords } from './cognition-views.ts';
import { param, requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { checkInput, queryObject } from './validate.ts';
import { proposedAgreementText } from '../../shared/agreement-diff.ts';
import { agreementSource } from './cognition-source.ts';

/** GET /v2/agreements */
export function listAgreements(context: RequestContext): Reply {
  requireAuth(context);
  const types = { limit: 'integer', offset: 'integer' } as const;
  const query = checkInput(AgreementListQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
  const offset = query.offset ?? 0;
  const filter = {
    ...(query.state === undefined ? {} : { state: query.state }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
  };
  const { state } = context.deps;
  const page = state.agreements.newestFirst(filter, { limit: limit + 1, offset });
  const body: AgreementListResponse = {
    agreements: page.slice(0, limit).map((agreement) => agreementView(agreement)),
    nextOffset: page.length > limit ? offset + limit : null,
  };
  return { status: 200, body };
}

/** GET /v2/agreements/:id */
export function getAgreement(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const agreement = state.agreements.get(param(context, 'id'));
  if (agreement === undefined) {
    throw notFoundError('这条约定');
  }
  const body: AgreementDetail = {
    agreement: agreementView(agreement),
    history: changeRecords(state.agreements.history(agreement.id), state),
    sourceContext: agreementSource(state, agreement.userQuote, agreement.quotedAt),
  };
  return { status: 200, body };
}

function conflict(deps: AppDeps, id: string): ApiError {
  const current = deps.state.agreements.require(id);
  return new ApiError(409, 'version_conflict', '这条约定在别处改过了，这次没有确认。', {
    currentVersion: current.version,
    next: '看 current 里的最新版，确认的是它再来。',
    extra: { current: agreementView(current) },
  });
}

/** POST /v2/agreements/:id/confirm — paired user confirmation. */
export function confirmAgreement(context: RequestContext): Promise<Reply> {
  const id = param(context, 'id');
  const { deps } = context;
  const check = (value: unknown) => checkInput(ConfirmAgreementRequestSchema, value, '确认约定');
  return confirmedWrite(context, check, (body, confirmation, afterCommit) => {
    let current = deps.state.agreements.get(id);
    if (current === undefined) {
      throw notFoundError('这条约定');
    }
    if (current.version !== body.version) {
      throw conflict(deps, id);
    }
    if (body.decision === 'adopt') {
      const text = current.proposedDiff === null ? null : proposedAgreementText(current.text, current.proposedDiff);
      if (text === null) {
        throw new ApiError(409, 'invalid_diff', '提议与原文对不上，请先核对或改正文。');
      }
      current = deps.state.agreements.update(id, current.version, { text, proposedDiff: null }, {
        actor: 'user', actorRef: confirmation.deviceId, reason: '用户在设备上采用提议', reasonKind: 'user_correction',
      });
    } else if (current.proposedDiff !== null) {
      current = deps.state.agreements.update(id, current.version, { proposedDiff: null }, {
        actor: 'user', actorRef: confirmation.deviceId, reason: '用户在设备上清掉提议', reasonKind: 'user_correction',
      });
    }
    let fields: AgreementConfirmed;
    let reason: string;
    if (body.decision === 'confirm' || body.decision === 'adopt') {
      const keep = current.state === 'active' && current.effectiveAt !== null;
      fields = { state: 'active', effectiveAt: keep ? current.effectiveAt : confirmation.confirmedAt };
      reason = body.reason ?? '用户在设备上确认这条约定生效';
    } else if (body.decision === 'revoke') {
      fields = { state: 'revoked' };
      reason = body.reason ?? '用户在设备上撤了这条约定';
    } else {
      fields = { state: current.state };
      reason = '用户在设备上不采纳提议';
    }
    let agreement: Agreement;
    try {
      agreement = body.decision === 'reject' ? current
        : deps.state.agreements.confirm(id, current.version, fields, confirmation, reason);
    } catch (error) {
      if (error instanceof StateError && error.code === 'version_conflict') {
        throw conflict(deps, id);
      }
      throw error;
    }
    afterCommit(() => {
      const now = deps.state.agreements.get(id);
      if (now !== undefined) {
        deps.hub.publish({ type: 'agreement_changed', agreement: agreementView(now) });
      }
    });
    const response: AgreementResponse = { agreement: agreementView(agreement) };
    return { status: 200, body: response };
  });
}

/** Editing an active agreement confirms its new wording and scope in the same confirmed transaction. */
export function editAgreement(context: RequestContext): Promise<Reply> {
  const id = param(context, 'id');
  const { deps } = context;
  return confirmedWrite(context, (value) => checkInput(EditAgreementRequestSchema, value, '改约定'),
    (body, confirmation, afterCommit) => {
      const current = deps.state.agreements.require(id);
      if (current.version !== body.version) {
        throw conflict(deps, id);
      }
      let next = deps.state.agreements.update(id, body.version, { text: body.text, scope: body.scope }, {
        actor: 'user', actorRef: confirmation.deviceId, reason: '用户在设备上修改约定', reasonKind: 'user_correction',
      });
      if (current.state === 'active') {
        next = deps.state.agreements.confirm(id, next.version,
          { state: 'active', effectiveAt: confirmation.confirmedAt }, confirmation, '用户在设备上确认修改后的约定');
      }
      const agreement = agreementView(next);
      afterCommit(() => deps.hub.publish({ type: 'agreement_changed', agreement }));
      return { status: 200, body: { agreement } };
    });
}
