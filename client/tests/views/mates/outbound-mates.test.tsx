import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { outboundGrant } from '../../../src/api/fake/outbound-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';

it('授权发送者列出真实在用队友名字，停用后不再提供新授权选择', async () => {
  const app = await renderApp({ hash: '#/settings/grants', setup: ({ control }) => {
    control.outbound.seed([outboundGrant(NOW)]);
  } });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '项目队友', avatar: 'bear',
    hue: 'olive', role: '整理项目', soul: '', purpose: null }));
  const section = await screen.findByRole('region', { name: '对外授权' });
  fireEvent.click(within(section).getByRole('button', { name: /授权操作/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: '修改授权' }));
  fireEvent.click(within(section).getByRole('button', { name: '修改谁来发' }));
  expect(await within(section).findByRole('option', { name: '项目队友' })).toHaveProperty('value', mate.id);
  await act(() => app.api.mates.update(mate.id, { requestId: createRequestId(), version: mate.version,
    disabled: true }));
  await waitFor(() => expect(within(section).queryByRole('option', { name: '项目队友' })).toBeNull());
});
