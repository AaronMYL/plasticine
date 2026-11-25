import { createHash } from 'node:crypto';
import { MateGroupTaskClaimArgsSchema as Claim, MateGroupTaskCreateArgsSchema as Create,
  MateGroupTaskListArgsSchema as Group } from '../../shared/api/mate-group-task-tools.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import type { MateGroupTasks } from './group-tasks.ts';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });

export function mateGroupTaskTools(tasks: MateGroupTasks): KernelTool[] {
  return [
    { name: 'mate_group_task_list', say: () => '看群组任务卡', hardLine: () => null,
      create: (scope) => ({ name: 'mate_group_task_list', label: '群组任务卡', parameters: Group, replay: 'safe',
        description: '列出所属队友群组的任务卡、领取队友和交付状态；不读取其他队友私聊。',
        async execute(_id, raw) {
          const input = checkedArgs(Group, raw, 'mate_group_task_list');
          return result({ lines: tasks.list(input.groupId, scope.lineId) });
        } }) },
    { name: 'mate_group_task_create', say: () => '发布群组任务卡', hardLine: () => null,
      create: (scope) => ({ name: 'mate_group_task_create', label: '发布任务卡', parameters: Create,
        description: '在所属队友群组发布完整目标，等待组内队友领取。发布时不开始执行。目标会公开在群内。',
        async execute(id, raw) {
          const input = checkedArgs(Create, raw, 'mate_group_task_create');
          const offerKey = createHash('sha256').update(JSON.stringify([scope.lineId, id])).digest('hex');
          return result({ line: tasks.offer({ ...input, sourceLineId: scope.lineId, offerKey }) });
        } }) },
    { name: 'mate_group_task_claim', say: () => '领取群组任务卡', hardLine: () => null,
      create: (scope) => ({ name: 'mate_group_task_claim', label: '领取任务卡', parameters: Claim,
        description: '以本人队友身份领取所属群组的待领任务，在原任务线上执行，完成后向群组交付。'
          + '同一任务只能被一位队友领取。',
        async execute(_id, raw) {
          const input = checkedArgs(Claim, raw, 'mate_group_task_claim');
          return result({ line: tasks.claim(input.taskId, scope.lineId) });
        } }) },
  ];
}
