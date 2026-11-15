// 一次性授权提示是给终端操作者的交互输出，不是诊断日志。服务、管道、重定向都不能显示代码。
export function requireInteractiveTerminal(): void {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true || process.stderr.isTTY !== true) {
    throw new Error('授权需要交互终端，不能重定向输出');
  }
}

export function showAuthorization(kind: 'pairing' | 'login', code: string, expiresAt: string): void {
  requireInteractiveTerminal();
  // 限定授权代码形状，拒绝控制字符；验证网址用固定值，绝不转发服务端返回的地址。
  if (!/^[a-z0-9-]{4,32}$/i.test(code)) {
    throw new Error('授权代码格式不正确');
  }
  const expiry = new Date(expiresAt).toISOString();
  const instruction = kind === 'pairing'
    ? '在设备的登录页输入配对码'
    : '打开 https://auth.openai.com/codex/device 输入授权码';
  process.stdout.write(`${instruction}：${code}（${expiry} 前有效，只能用一次）。\n`);
}
