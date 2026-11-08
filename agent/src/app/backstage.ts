// /v2/backstage（shared/api/backstage.ts）：常驻项目 Plasticine 的后台。读：定时 · 规则 · 通知信；写：规则开关。
// 通知信按 shared/plasticine-notice.ts（联系人列表按同一个判断排除）。2026-11-05 Harness 重做：任务没了，「停下的」
// 「在做」恒为空（字段留给旧客户端，标着待客户端切完后删），在跑的线看 /v2/lines。
// 规则开关和长期维护入口（app/maintenance.ts）一样：只改档位、同一事务里记一条 rule_events；维护入口凭你的原话、记
// maintenance，这里是你在自己设备上点的、记 user + 设备。不改规则文字，不删任何东西。

import {
  BACKSTAGE_NOTICES_MAX,
  BackstageQuerySchema,
  DEFAULT_TIME_ZONE,
  SetBackstageRuleRequestSchema,
  type BackstageNotice,
  type BackstageResponse,
  type BackstageRule,
  type SetBackstageRuleResponse,
} from '../../shared/api/index.ts';
import { isPlasticineNotice, PLASTICINE_NOTICE_SOURCE } from '../../shared/plasticine-notice.ts';
import type { Rule, RuleMode } from '../../shared/state.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { systemSchedules } from './system-schedules.ts';
import { checkInput, queryObject } from './validate.ts';

function ruleView(rule: Rule): BackstageRule {
  return { id: rule.id, code: rule.code, name: rule.name, text: rule.text, mode: rule.mode, on: rule.mode === 'auto',
    version: rule.version };
}

function notices(deps: AppDeps): BackstageNotice[] {
  return deps.state.inboxMessages.thread({ source: PLASTICINE_NOTICE_SOURCE }, undefined, BACKSTAGE_NOTICES_MAX)
    .filter(isPlasticineNotice)
    .map((message) => ({ id: message.id, title: message.title, at: message.receivedAt,
      read: message.readAt !== null }));
}

/** GET /v2/backstage?tz= */
export function getBackstage(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(BackstageQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const { deps } = context;
  const body: BackstageResponse = {
    schedules: systemSchedules({ state: deps.state, now: deps.now(), automaticBackups: deps.backups.automatic }),
    rules: deps.state.rules.all().map(ruleView),
    notices: notices(deps),
    timeZone: query.tz ?? DEFAULT_TIME_ZONE,
  };
  return { status: 200, body };
}

/** POST /v2/backstage/rules/:code：开 = 自动档，关 = 关档。 */
export async function setBackstageRule(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const code = param(context, 'code');
  const body = checkInput(SetBackstageRuleRequestSchema, await readJsonBody(context.req), '规则开关');
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    const rule = state.rules.byCode(code);
    if (rule === undefined) {
      throw notFoundError('这条规则');
    }
    if (rule.version !== body.version) {
      throw new ApiError(409, 'version_conflict', '这条规则在别处改过了，这次没有改。', {
        currentVersion: rule.version,
        next: '看一眼它现在开没开，再决定。',
        extra: { current: ruleView(rule) },
      });
    }
    const to: RuleMode = body.on ? 'auto' : 'off';
    if (rule.mode === to) {
      const unchanged: SetBackstageRuleResponse = { rule: ruleView(rule) };
      return { status: 200, body: unchanged };
    }
    const reason = `你在后台把「${rule.name}」${body.on ? '打开' : '关上'}了（设备：${auth.device.name}）`;
    const updated = state.transaction(() => {
      const changed = state.rules.update(rule.id, rule.version, { mode: to },
        { actor: 'user', actorRef: auth.device.id, reason });
      state.rules.addEvent({ ruleId: rule.id, kind: 'mode_changed', fromMode: rule.mode, toMode: to,
        ruleVersion: changed.ruleVersion, actor: 'user', reason });
      return changed;
    });
    const response: SetBackstageRuleResponse = { rule: ruleView(updated) };
    return { status: 200, body: response };
  });
}
