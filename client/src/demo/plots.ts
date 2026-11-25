import { pieces } from '../api/fake/fake-line-script.ts';
import type { TeamPlot } from './scenes.ts';

export const MEDIA: TeamPlot = {
  group: '自媒体运营',
  ask: '照这周的来信和信息流，做一期讲记忆的视频。',
  reply: { thinking: pieces('选题编辑定角度，定了交给文案；分镜挂成任务卡。'),
    steps: [{ tool: 'mate_list', say: '看队友花名册', result: '4 位队友' },
      { tool: 'mate_handoff', say: '交给选题编辑', result: '选题编辑接了' }],
    answer: pieces('分好了：选题编辑先定角度，定了交给文案写口播稿；分镜挂成任务卡，等队友领取。') },
  first: { lineId: 'media-topic', handTo: '文案', goal: '写「记忆为什么要整理」的口播稿',
    steps: [{ tool: 'feed_read', say: '读来信和收藏的 12 条', ms: 2000 },
      { tool: 'note_write', say: '写三个角度', ms: 2200 }],
    then: [{ tool: 'note_read', say: '读选题', ms: 1500 }, { tool: 'note_write', say: '写口播稿', ms: 2600 }] },
  second: { lineId: 'media-data', card: '把口播稿拆成分镜', claimer: '剪辑师',
    steps: [{ tool: 'web_fetch', say: '第 3 / 3 条', ms: 1800 }, { tool: 'note_write', say: '写数据小结', ms: 1500 }],
    then: [{ tool: 'note_write', say: '拆分镜', ms: 2600 }] },
};

export const DEV: TeamPlot = {
  group: '软件开发',
  ask: '同步冲突这一版，照规格排一下。',
  reply: { thinking: pieces('规格归产品经理，写完交给开发；测试清单挂成任务卡。'),
    steps: [{ tool: 'mate_list', say: '看队友花名册', result: '4 位队友' },
      { tool: 'mate_handoff', say: '交给产品经理', result: '产品经理接了' }],
    answer: pieces('分好了：产品经理先写规格，写完交给开发工程师；测试清单挂成任务卡，等队友领取。') },
  first: { lineId: 'team-spec', handTo: '开发工程师', goal: '照规格写同步冲突的合并',
    steps: [{ tool: 'note_read', say: '读那篇讲同步冲突的博客', ms: 2000 },
      { tool: 'note_write', say: '写规格第 3 节', ms: 2400 }],
    then: [{ tool: 'file_read', say: '读规格', ms: 1600 }, { tool: 'code_write', say: '写合并逻辑', ms: 2600 }] },
  second: { lineId: 'team-test', card: '把验收标准', claimer: '测试工程师',
    steps: [{ tool: 'browser_act', say: '9 / 12 条过了', ms: 1500 },
      { tool: 'browser_act', say: '12 / 12 条过了', ms: 1700 }],
    then: [{ tool: 'note_write', say: '写测试清单', ms: 2600 }] },
};
