import { Type } from 'typebox';
import { MateDraftSchema } from '../../shared/api/mates.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import type { Mates } from './service.ts';

const Handoff = Type.Object({ mateId: Type.String({ minLength: 1 }),
  goal: Type.String({ minLength: 1, maxLength: 20_000 }),
  newTask: Type.Optional(Type.Boolean({ description: '这位队友手上有没做完的任务、但这次确实是另一件事时写 true' })),
}, { additionalProperties: false });
const Empty = Type.Object({}, { additionalProperties: false });
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });

export function mateTools(mates: Mates): KernelTool[] {
  return [
    { name: 'mate_list', say: () => '看队友花名册', hardLine: () => null,
      create: () => ({ name: 'mate_list', label: '队友花名册', parameters: Empty, replay: 'safe',
        description: '列出队友的 id、职责、停用状态和群组。按职责选择队友；不要编造队友。',
        async execute() { return result(mates.list()); } }) },
    { name: 'mate_handoff', say: () => '交给队友', hardLine: () => null,
      create: (scope) => ({ name: 'mate_handoff', label: '交给队友', parameters: Handoff,
        description: '把完整目标交给指定队友。队友独立执行；你交代的话和它交回的结论都贴在那位队友自己的对话里，'
          + '用户在你这里看不到原文：结论回到你这里后，用你自己的话整理好再告诉用户，别原样复述。群组里只能交给本组成员，'
          + '来回都在群组对话里。包括要点、上下文、交付要求；等待结果时可继续交流。这位队友手上有没做完的任务时不会'
          + '另开，会把那几条列给你：同一件事接着做原来那条。',
        async execute(_id, raw) {
          const { newTask, ...input } = checkedArgs(Handoff, raw, 'mate_handoff');
          const open = mates.unfinished(input.mateId);
          if (open.length > 0 && newTask !== true) {
            return result({ handedOff: false, unfinished: open, next: '这位队友手上还有没做完的任务，这次没有交新的。'
              + '是同一件事：用 line_resume 接着做那条（要补话先 tell_line，作废的话用 line_queue_withdraw 撤回）；'
              + '旧的作废了：line_end 收掉再交；确实是另一件事：带 newTask: true 再交。' });
          }
          return result({ line: mates.handoff({ ...input, sourceLineId: scope.lineId }, undefined, [],
            { resumeParent: true }) });
        } }) },
    { name: 'mate_create', say: (args) => `建立队友「${String(args['name'] ?? '')}」`,
      lineKinds: ['main', 'side'], hardLine: () => 'permission',
      consequence: () => '会新增一位长期队友，保存职责和独立对话；可以随时编辑或停用。',
      approveLabel: () => '建立队友',
      create: () => ({ name: 'mate_create', label: '建立队友', parameters: MateDraftSchema,
        description: '提议建立长期队友，先给用户确认名字、头像、职责、Soul和模型用途；用户确认后才创建。',
        async execute(_id, raw) { return result(mates.create(checkedArgs(MateDraftSchema, raw, 'mate_create'))); } }) },
  ];
}
