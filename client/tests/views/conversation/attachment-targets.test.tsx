import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { ApiProvider } from '../../../src/api/context.tsx';
import { ClientStateProvider, createClientState } from '../../../src/state/context.tsx';
import { SideUiProvider } from '../../../src/views/lines/conversation-ui-context.tsx';
import { AttachmentChips, AttachmentComposer } from '../../../src/views/conversation/attachment-composer.tsx';

it('切换对话只显示并移除当前目标的附件，不动主线或别人的草稿', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  const state = createClientState();
  const tree = (lineId: string) => <ApiProvider api={fake.api}><ClientStateProvider state={state}>
    <SideUiProvider lineId={lineId}><AttachmentChips /><AttachmentComposer /></SideUiProvider>
  </ClientStateProvider></ApiProvider>;
  const view = render(tree('mate-a'));
  fireEvent.change(screen.getByLabelText('选择对话附件'), { target: {
    files: [new File(['文件正文'], '示例材料.txt', { type: 'text/plain' })],
  } });
  await waitFor(() => expect(state.conversations.forLine('mate-a').attachments.active()).toHaveLength(1));
  expect(state.attachments.active()).toEqual([]);
  view.rerender(tree('mate-b'));
  expect(screen.queryByText('示例材料.txt')).toBeNull();
  view.rerender(tree('mate-a'));
  expect(screen.getByText('示例材料.txt')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移除附件 示例材料.txt' }));
  expect(state.conversations.forLine('mate-a').attachments.active()).toEqual([]);
});
