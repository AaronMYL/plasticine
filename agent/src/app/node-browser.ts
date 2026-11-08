// 节点已经配对，凭节点能力打开自己的网页；给的是系统浏览器会话，不复制个人会话或签名钥匙。
import type { Reply, RequestContext } from './context.ts';
import { requireNode } from './node-protocol.ts';

export function nodeBrowserSession(context: RequestContext): Reply {
  const node = requireNode(context);
  const opened = context.deps.browserSessions.open(node);
  return { status: 201, body: { actor: 'system' },
    headers: { 'set-cookie': opened.cookie, 'cache-control': 'no-store' } };
}
