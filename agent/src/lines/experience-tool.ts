// 记一条做事经验（记忆分层，11-15）：做事过程中试出来的、下次用得上的做法或坑，当场记进「做事经验」里那个工具、网站或
// 流程的一篇，下次开工前读得到。直接生效，不用他确认；他在记忆页看得到出处（这条线），能改能删。
// 关于他这个人的事、他说的偏好不走这里（用 remember）。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { noteExperience, type DocState } from '../memory/index.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

// 参数在函数里拼、不放在文件顶层：memory/ 和 lines/ 互相引用（同 remember-tool.ts）。
function parameters() {
  return Type.Object({
    topic: Type.String({ minLength: 1, maxLength: 60,
      description: '哪个工具、网站或流程（做事经验里那一篇的名字，照目录写；没有就写个新的，比如「小红书」「发邮件」）' }),
    kind: Type.Enum(['do', 'avoid'], { description: 'do：走得通的做法；avoid：要避开的坑' }),
    text: Type.String({ minLength: 1, maxLength: 500, description: '一句能照着做的话，写清条件和做法' }),
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 150,
      description: '新建这一篇时的一句话说明：讲什么、什么时候该读' })),
    sites: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 4,
      description: '这一篇对应的网站域名或应用名（如 mp.weixin.qq.com、微信）：以后碰到它们时自动带出这一篇' })),
    replacesLineId: Type.Optional(Type.String({ minLength: 1,
      description: '同一件事有了新结果时，改那一行（行标识照 read_memory_doc 里的写）' })),
  }, { additionalProperties: false });
}
type ExperienceParameters = ReturnType<typeof parameters>;

function createExperience(state: DocState, scope: LineScope): AgentTool<ExperienceParameters> {
  const schema = parameters();
  return {
    name: 'note_experience',
    label: '记一条做事经验',
    description: '做事时自己试出来、下次还用得上的做法或坑（某个网站要先做什么、哪条路走不通、某个工具的参数怎么填），'
      + '当场记进「做事经验」里那个工具、网站或流程的一篇。只记亲手试过、确实如此的，一句话写清条件和做法；'
      + '猜的、只出现一次的偶然情况、查来的常识不记。关于他这个人的事和他说的偏好用 remember，不用这个。'
      + '后来的结果和以前记的不一样，就用 replacesLineId 改那一行。',
    parameters: schema,
    async execute(_toolCallId, raw) {
      const args = checkedArgs(schema, raw, 'note_experience');
      const result = noteExperience(state, { topic: args.topic, section: args.kind, text: args.text,
        lineId: scope.lineId, ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.replacesLineId === undefined ? {} : { replacesLineId: args.replacesLineId }),
        ...(args.sites === undefined ? {} : { sites: args.sites }) },
      { actor: 'brain', ref: `line:${scope.lineId}` });
      const text = result.saved
        ? JSON.stringify({ saved: true, doc: result.doc.title, lineId: result.line.id,
          note: '记进了做事经验。接着做手上的事；记下本身不算交付。' })
        : JSON.stringify({ saved: false, reason: result.reason, note: '这次没有新记，照常接着做。' });
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}

export function experienceTool(state: DocState): KernelTool {
  return {
    name: 'note_experience',
    say: (args) => (typeof args['text'] === 'string' ? `记一条经验：${args['text']}` : '记一条做事经验'),
    hardLine: () => null,
    create: (scope) => createExperience(state, scope),
  };
}
