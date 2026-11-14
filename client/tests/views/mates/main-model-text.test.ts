// 编辑主线的「模型」一格（第13批）：跟默认时右边写主线实际在用的（思考档可能单独设过），和输入框里的模型按钮一致。
import { expect, it } from 'vitest';
import { mainModelText, withMainChoice } from '../../../src/views/mates/model-field.tsx';

const provider = {
  id: 'deepseek', name: 'deepseek', methods: ['api_key' as const], loginLabel: null, connected: 'oauth' as const,
  account: null, plan: null, keyLast4: null, enabled: ['m'],
  models: [{ id: 'm', name: 'M 1', contextWindow: 1, reasoning: true, thinkingLevels: ['medium' as const,
    'high' as const], input: ['text' as const] }],
};
const value = { providers: [provider], version: 0, defaultIssue: null,
  chosen: { provider: 'deepseek', model: 'm', thinking: 'high' as const },
  effective: { provider: 'deepseek', model: 'm', thinking: 'high' as const },
  purposes: [{ purpose: 'main' as const, chosen: { model: null, thinking: 'medium' as const },
    effective: { provider: 'deepseek', model: 'm', thinking: 'medium' as const }, issue: null }] };

it('跟默认时写主线实际在用的那一档，不是默认的那一档', () => {
  expect(mainModelText(value)).toEqual({ name: '跟默认', meta: 'M 1 · 中等' });
});

it('选了还没存的当成选上来显示：模型名带档位、右边写哪一家', () => {
  const shown = withMainChoice(value, { model: { provider: 'deepseek', model: 'm' }, thinking: 'high' });
  expect(mainModelText(shown)).toEqual({ name: 'M 1 · 较高', meta: 'DeepSeek' });
});
