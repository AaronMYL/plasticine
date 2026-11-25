import type { Reply, RequestContext } from './context.ts';
import { requireNode } from './node-protocol.ts';

export function nodeBrowserSession(context: RequestContext): Reply {
  const node = requireNode(context);
  const opened = context.deps.browserSessions.open(node);
  return { status: 201, body: { actor: 'system' },
    headers: { 'set-cookie': opened.cookie, 'cache-control': 'no-store' } };
}
