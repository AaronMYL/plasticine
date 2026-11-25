import {
  ConfirmMarksRequestSchema,
  CONTACT_RELATIONS,
  SetMarkRequestSchema,
  type MaterialRow,
  type VisibilityResponse,
} from '../../shared/api/index.ts';
import type { MaterialKind } from '../../shared/api/visibility.ts';
import { listMaterials, type MaterialEntry } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import { notFoundError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function materialRow(state: StateService, entry: MaterialEntry): MaterialRow {
  const mark = state.visibilityMarks.get(entry.kind, entry.id);
  return {
    kind: entry.kind,
    id: entry.id,
    title: entry.title,
    tier: mark?.confirmedAt == null ? 'private' : mark.tier,
    proposed: mark === undefined ? entry.suggestion : mark.proposed,
    version: mark?.version ?? 0,
  };
}

export function visibilityView(state: StateService): VisibilityResponse {
  const materials = listMaterials(state).map((entry) => materialRow(state, entry));
  const active = state.contacts.all().filter((contact) => contact.state === 'active');
  return {
    relations: CONTACT_RELATIONS.map((relation) => ({ relation,
      count: active.filter((contact) => contact.relation === relation).length })),
    materials,
    pending: materials.filter((row) => row.proposed !== null).length,
  };
}

function findMaterial(state: StateService, kind: MaterialKind, id: string): MaterialEntry {
  const entry = listMaterials(state).find((candidate) => candidate.kind === kind && candidate.id === id);
  if (entry === undefined) {
    throw notFoundError('这份材料');
  }
  return entry;
}

/** GET /v2/visibility */
export function getVisibility(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: visibilityView(context.deps.state) };
}

export async function setVisibilityMark(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(SetMarkRequestSchema, await readJsonBody(context.req), '定档');
  const { state } = context.deps;
  const entry = findMaterial(state, body.kind, body.id);
  return idempotent(context, body.requestId, () => {
    withCurrent(() => state.visibilityMarks.put(body.kind, body.id, body.version,
      { tier: body.tier, proposed: null, confirmed: true }),
    () => materialRow(state, entry), () => state.visibilityMarks.get(body.kind, body.id)?.version ?? 0);
    return { status: 200, body: { ...visibilityView(state), material: materialRow(state, entry) } };
  });
}

export async function confirmVisibility(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ConfirmMarksRequestSchema, await readJsonBody(context.req), '确认建议');
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    const wanted = body.items === undefined ? null
      : new Set(body.items.map((item) => `${item.kind}:${item.id}`));
    for (const entry of listMaterials(state)) {
      const row = materialRow(state, entry);
      if (row.proposed === null || (wanted !== null && !wanted.has(`${row.kind}:${row.id}`))) {
        continue;
      }
      state.visibilityMarks.put(row.kind, row.id, row.version, { tier: row.proposed, proposed: null,
        confirmed: true });
    }
    return { status: 200, body: visibilityView(state) };
  });
}
