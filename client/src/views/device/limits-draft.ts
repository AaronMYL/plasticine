// 上限表单的草稿：按节点 id 存进 inline-drafts（sessionStorage，key = `node:<id>:limits`），切页、重新配对、刷新之后还在，
// 发出去拿到结果才清。草稿是整张表单的 JSON；读不懂（格式变了）就当没有草稿，从现在的上限重填。每小时次数按字存，
// 发之前才换成数：写错了就地说哪一类不对，不发。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  DEVICE_ACTION_CLASSES,
  DEVICE_CLASS_MODES,
  DEVICE_PER_HOUR_MAX,
  DeviceLimitsSchema,
} from '../../api/shared.ts';
import type { DeviceClassMode, DeviceLimits } from '../../api/types.ts';

export const MODE_LABELS: Readonly<Record<DeviceClassMode, string>> = {
  allow: '允许',
  confirm_each: '逐次确认',
  deny: '不许',
};

const ClassDraftSchema = Type.Object({ mode: Type.Enum(DEVICE_CLASS_MODES), perHour: Type.String() });

export const LimitsDraftSchema = Type.Object({
  limitsVersion: Type.Optional(Type.Integer({ minimum: 0 })),
  roots: Type.String(),
  sites: Type.String(),
  apps: Type.String(),
  unattendedInput: Type.Boolean(),
  classes: Type.Object({
    read: ClassDraftSchema,
    write: ClassDraftSchema,
    delete: ClassDraftSchema,
    command: ClassDraftSchema,
    browser: ClassDraftSchema,
    input: ClassDraftSchema,
  }),
});
export type LimitsDraft = Static<typeof LimitsDraftSchema>;

function lines(list: readonly string[]): string {
  return list.join('\n');
}

export function draftOf(limits: DeviceLimits, limitsVersion?: number): LimitsDraft {
  const classes = Object.fromEntries(
    DEVICE_ACTION_CLASSES.map((name) => {
      const rule = limits.classes[name];
      return [name, { mode: rule.mode, perHour: String(rule.perHour) }];
    }),
  );
  const draft = {
    ...(limitsVersion === undefined ? {} : { limitsVersion }),
    roots: lines(limits.roots),
    sites: lines(limits.sites),
    apps: lines(limits.apps),
    unattendedInput: limits.unattendedInput,
    classes,
  };
  if (!Value.Check(LimitsDraftSchema, draft)) {
    throw new Error('上限换成表单草稿时格式不对');
  }
  return draft;
}

/** The stored text, or null when there is none or it cannot be read any more. */
export function parseDraft(text: string): LimitsDraft | null {
  if (text === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Value.Check(LimitsDraftSchema, parsed) ? parsed : null;
  } catch (error) {
    console.warn('上限表单的草稿读不懂，从现在的上限重填', error);
    return null;
  }
}

function listOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export type DraftCheck = { ok: true; limits: DeviceLimits } | { ok: false; problem: string };

export function limitsOf(draft: LimitsDraft, labels: Readonly<Record<string, string>>): DraftCheck {
  const classes: Record<string, { mode: LimitsDraft['classes']['read']['mode']; perHour: number }> = {};
  for (const name of DEVICE_ACTION_CLASSES) {
    const entry = draft.classes[name];
    const value = entry.perHour.trim();
    const perHour = /^\d+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(perHour) || perHour > DEVICE_PER_HOUR_MAX) {
      return { ok: false, problem: `「${labels[name] ?? name}」的每小时次数要是 0 到 ${DEVICE_PER_HOUR_MAX} 的整数。` };
    }
    classes[name] = { mode: entry.mode, perHour };
  }
  const limits = {
    roots: listOf(draft.roots),
    sites: listOf(draft.sites),
    apps: listOf(draft.apps),
    unattendedInput: draft.unattendedInput,
    classes,
  };
  const bad = limits.roots.find((root) => !root.startsWith('/') && root !== '~' && !root.startsWith('~/'));
  if (bad !== undefined) {
    return { ok: false, problem: `授权目录「${bad}」要写成 / 或 ~ 开头的完整路径。` };
  }
  if (!Value.Check(DeviceLimitsSchema, limits)) {
    const first = Value.Errors(DeviceLimitsSchema, limits)[0];
    return { ok: false, problem: `上限的格式不对（${first?.instancePath ?? ''} ${first?.message ?? ''}）。` };
  }
  return { ok: true, limits };
}
