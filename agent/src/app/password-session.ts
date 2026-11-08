// 登录（2026-11-08《首次使用流程》，配对码下掉了）：
// - POST /v2/session/password：别的设备用 @账号（找到这份 Plasticine）+ 密码登录；输错限流，文案不说是哪个错。
// - POST /v2/session/local：桌面客户端凭本机令牌替本机界面登录（只认 127.0.0.1 直连），设备记成本机，再登录用回
//   同一台，设备列表里只有一台「这台电脑」。

import { LocalSessionRequestSchema, PasswordSessionRequestSchema } from '../../shared/api/account.ts';
import type { Device } from '../../shared/state.ts';
import { ApiError } from './api-error.ts';
import type { Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { localTokenValid } from './local-access.ts';
import { loginDevice, loginReply, ownerDevices, setupNeeded } from './owner.ts';
import { checkNotLimited, passwordMatches, recordFailure } from './password-check.ts';
import { checkInput } from './validate.ts';

function needsSetup(): ApiError {
  return new ApiError(409, 'setup_needed', '这份 Plasticine 还没建账号。', { next: '先建账号：名字、@账号和密码。' });
}

/** POST /v2/session/password */
export async function passwordLogin(context: RequestContext): Promise<Reply> {
  const { deps } = context;
  const body = checkInput(PasswordSessionRequestSchema, await readJsonBody(context.req), '登录');
  const source = checkNotLimited(context);
  if (setupNeeded(deps.state)) {
    throw needsSetup();
  }
  if (!await passwordMatches(deps, body.password)) {
    recordFailure(context, source);
    throw new ApiError(401, 'login_failed', '账号或密码不对。', {
      next: '核对后再输；忘了密码，在装着 Plasticine 的那台电脑上重设（服务器上运行 plasticine password）。',
    });
  }
  const login = deps.state.transaction(() => loginDevice(deps, { name: body.deviceName, local: false }, deps.now()));
  return loginReply(login);
}

function localDevice(devices: Device[]): Device | undefined {
  return devices.find((device) => device.local === true && device.revokedAt === null);
}

/** POST /v2/session/local */
export async function localLogin(context: RequestContext): Promise<Reply> {
  const { deps } = context;
  const body = checkInput(LocalSessionRequestSchema, await readJsonBody(context.req), '本机登录');
  if (!localTokenValid(deps.localToken, context.req)) {
    throw new ApiError(403, 'local_only', '只有这台电脑上的 Plasticine 客户端能这样登录。',
      { next: '用 @账号和密码登录。' });
  }
  if (setupNeeded(deps.state)) {
    throw needsSetup();
  }
  const login = deps.state.transaction(() => {
    const existing = localDevice(ownerDevices(deps.state));
    return loginDevice(deps, { name: body.deviceName, local: true,
      ...(existing === undefined ? {} : { existing }) }, deps.now());
  });
  return loginReply(login);
}
