import { expect, it } from 'vitest';
import { mainModelText, withMainChoice } from '../../../src/views/mates/model-field.tsx';

const provider = {
  id: 'deepseek', name: 'deepseek', methods: ['api_key' as const], loginLabel: null, connected: 'oauth' as const,
  account: null, plan: null, keyLast4: null, enabled: ['m'], custom: null,
  models: [{ id: 'm', name: 'M 1', contextWindow: 1, reasoning: true, thinkingLevels: ['medium' as const,
    'high' as const], input: ['text' as const] }],
};
const value = { providers: [provider], version: 0, defaultIssue: null,
  chosen: { provider: 'deepseek', model: 'm', thinking: 'high' as const },
  effective: { provider: 'deepseek', model: 'm', thinking: 'high' as const },
  purposes: [{ purpose: 'main' as const, chosen: { model: null, thinking: 'medium' as const },
    effective: { provider: 'deepseek', model: 'm', thinking: 'medium' as const }, issue: null }] };

it('follow-default displays main thread\'s actual active tier instead of static default tier', () => {
  expect(mainModelText(value)).toEqual({ name: '跟默认', meta: 'M 1 · 中等' });
});

it('displays unsaved selection as chosen with model name, tier, and provider on the right', () => {
  const shown = withMainChoice(value, { model: { provider: 'deepseek', model: 'm' }, thinking: 'high' });
  expect(mainModelText(shown)).toEqual({ name: 'M 1 · 较高', meta: 'DeepSeek' });
});
