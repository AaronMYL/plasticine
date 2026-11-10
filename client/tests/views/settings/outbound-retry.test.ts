import { expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { outboundAsk } from '../../../src/api/fake/outbound-seed.ts';
import { EventsHub } from '../../../src/api/events-hub.ts';
import { uncertainError } from '../../../src/api/errors.ts';
import { AsksStore } from '../../../src/views/asks/asks-store.ts';

it('授权回执丢失时相同范围复用请求编号，修改范围使用新编号', async () => {
  const { api, control } = createFakeApi({ seed: false, streamStepMs: 0 });
  control.session.signInForDevelopment('fixture-device');
  const ask = control.asks.raise(outboundAsk());
  const answer = vi.spyOn(api.asks, 'answer').mockRejectedValue(uncertainError('作答'));
  const store = new AsksStore(api, new EventsHub(api.events));
  const input = { optionId: 'allow', outboundGrant: ask.outbound!.grant };
  await store.answer(ask, input);
  await store.answer(ask, input);
  await store.answer(ask, { ...input, outboundGrant: { ...input.outboundGrant, scope: { kind: 'always' } } });
  expect(answer.mock.calls[1]![1].requestId).toBe(answer.mock.calls[0]![1].requestId);
  expect(answer.mock.calls[2]![1].requestId).not.toBe(answer.mock.calls[0]![1].requestId);
});
