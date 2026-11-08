// 用户亲手操作不受脑的干跑限制；正文不写回执库，只有内存去重。旧版核实入口留给已有回执。
import {
  BrowserActionRequestSchema, BrowserTabRequestSchema, OpenBrowserRequestSchema, SettleActionRequestSchema,
  type BrowserActionResponse, type BrowserResponse, type SettleActionResponse,
} from '../../shared/api/index.ts';
import { CloudToolError } from '../cloud-tools/index.ts';
import { settleExternal } from '../system/index.ts';
import { notFoundError, unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

// 与脑的浏览器工具相同，单次手动操作最多等 30 秒。
const OPERATION_MS = 30_000;
export function browserActionId(requestId: string): string { return `browser:${requestId}`; }

export async function getBrowser(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const { browser } = context.deps.m5b.cloud;
  try {
    await browser.refresh(AbortSignal.timeout(OPERATION_MS));
  } catch (error) {
    if (!(error instanceof CloudToolError && error.code === 'not_configured')) {
      throw error;
    }
    // 连接失败也返回状态，客户端显示重试入口。
  }
  const body: BrowserResponse = { browser: browser.view() };
  return { status: 200, body };
}

export async function getBrowserFrame(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const data = await context.deps.m5b.cloud.browser.frame(AbortSignal.timeout(OPERATION_MS));
  return { status: 200, bytes: { data, type: 'image/png', noStore: true } };
}

function authenticated(context: RequestContext): string {
  const auth = requireAuth(context);
  if (!stillAuthenticated(context.deps, auth)) {
    throw unauthorized('这台设备的登录在请求途中失效了，这次没有执行。');
  }
  return auth.session.id;
}

export async function openBrowser(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(OpenBrowserRequestSchema, await readJsonBody(context.req), '打开网址');
  const owner = authenticated(context);
  const { browser } = context.deps.m5b.cloud;
  const view = await browser.requests.run(owner, body.requestId, body.instanceId, body,
    () => browser.userOpen(body.url, AbortSignal.timeout(OPERATION_MS)));
  return { status: 200, body: { browser: view } satisfies BrowserResponse };
}

export async function actBrowser(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(BrowserActionRequestSchema, await readJsonBody(context.req), '浏览器操作');
  const owner = authenticated(context);
  const { browser } = context.deps.m5b.cloud;
  const view = await browser.requests.run(owner, body.requestId, body.instanceId, body,
    () => browser.userAct(body.action, AbortSignal.timeout(OPERATION_MS), body.tabId));
  return { status: 200, body: { browser: view, outcome: 'done' } satisfies BrowserActionResponse };
}

export async function tabBrowser(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(BrowserTabRequestSchema, await readJsonBody(context.req), '浏览器标签页');
  const owner = authenticated(context);
  const { browser } = context.deps.m5b.cloud;
  const view = await browser.requests.run(owner, body.requestId, body.instanceId, body,
    () => browser.tab(body.action, AbortSignal.timeout(OPERATION_MS)));
  return { status: 200, body: { browser: view } satisfies BrowserResponse };
}

export async function settleAction(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SettleActionRequestSchema, await readJsonBody(context.req), '核实');
  const actionId = browserActionId(param(context, 'requestId'));
  const { deps } = context;
  return idempotent(context, body.requestId, () => {
    const receipt = settleExternal(deps.state, actionId, body.happened, deps.now);
    if (receipt === undefined) {
      throw notFoundError('这个动作的记录');
    }
    const response: SettleActionResponse = { status: receipt.status };
    return { status: 200, body: response };
  });
}
