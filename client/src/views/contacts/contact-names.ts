// 第 12 批：对方的主线 AI 怎么称呼——「林一的 Plasticine」；对方给它起了名字（资料里的 aiName）就写「林一的 小满」。
// 只有一对一的联系人知道对方 AI 的名字；群里成员照写 Plasticine。

import type { ContactRow } from '../../api/shared.ts';

export function theirAi(contact: Pick<ContactRow, 'name' | 'aiName'>): string {
  return `${contact.name}的 ${contact.aiName ?? 'Plasticine'}`;
}
