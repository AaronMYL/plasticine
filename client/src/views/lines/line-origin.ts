import type { LineInputOrigin, LineMessageView } from '../../api/shared.ts';

/** 模型的 user role 包括委派和系统输入；署名只看保存下来的真实来源。 */
export function inputAuthor(origin: LineInputOrigin | null | undefined): string {
  switch (origin?.kind) {
    case 'user': return '你';
    case 'delegation': return 'Plasticine';
    case 'trigger': return '自动触发';
    case 'network': return '网络任务';
    case 'system': return '系统';
    default: return '来源未记录';
  }
}

export function messageAuthor(message: LineMessageView): string {
  return message.role === 'user' ? inputAuthor(message.origin) : 'Plasticine';
}
