import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { SpaceRevisionCard } from '../../../src/views/spaces/space-revision-card.tsx';
import { ClientStateProvider, createClientState } from '../../../src/state/context.tsx';
import { LiveProvider } from '../../../src/live.tsx';
import { PushDeviceContext } from '../../../src/api/push-device.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';

it('版本卡显示真正的标题与改动，能对照修改前后并回到这一版', async () => {
  const fake = createFakeApi({ seed: true, streamStepMs: 0 });
  const first = await fake.api.spaces.get('sp_cog_1');
  await fake.api.spaces.save(first.id, { requestId: 'card-revision', version: first.version,
    html: '<p>改过之后的文字</p>' });
  render(<ApiProvider api={fake.api}><ClientStateProvider state={createClientState()}>
    <PushDeviceContext.Provider value={new FakePushDevice()}><LiveProvider>
      <SpaceRevisionCard result={{ id: first.id, title: first.title, version: 2, change: '补了例子', genre: 'report' }} />
    </LiveProvider></PushDeviceContext.Provider>
  </ClientStateProvider></ApiProvider>);
  expect(screen.getByText('第 2 版 · 补了例子')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '看改了什么' }));
  await screen.findByRole('dialog', { name: '第 2 版的修改' });
  expect(await screen.findByText('改过之后的文字')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '打开这一版' }));
  expect(location.hash).toBe('#/books/space/sp_cog_1/2/1');
});
