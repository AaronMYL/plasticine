// 一次请求用的队友服务。单独一个文件：mates.ts、lines.ts、mate-group-tasks.ts 都要它，放在其中一个里另外两个就绕成圈。
import { Mates } from '../mates/index.ts';
import type { RequestContext } from './context.ts';

export function matesFor(context: RequestContext): Mates {
  return new Mates(context.deps.state, () => context.deps.lines);
}
