// 假实现里一条改动记录（判断的来路、记忆条目的用户编辑记录、约定的历史）怎么写。

import type { ChangeRecordView } from '../types.ts';

export interface ChangeInput {
  version: number;
  actor: ChangeRecordView['actor'];
  reason: string;
  fields: string[];
  at: string;
  reasonKind?: ChangeRecordView['reasonKind'];
  confirmedByDevice?: boolean;
}

export function changeRecord(input: ChangeInput): ChangeRecordView {
  return {
    version: input.version,
    actor: input.actor,
    reason: input.reason,
    reasonKind: input.reasonKind ?? (input.actor === 'user' ? 'user_correction' : null),
    fields: input.fields,
    verificationChanged: input.fields.includes('verification'),
    confirmedByDevice: input.confirmedByDevice ?? false,
    at: input.at,
  };
}
