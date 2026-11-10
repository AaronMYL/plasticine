import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { createClientState, ClientStateProvider } from '../../../src/state/context.tsx';
import { SoulPage } from '../../../src/views/plasticine/soul-page.tsx';

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试设备');
  render(<ApiProvider api={fake.api}><ClientStateProvider state={createClientState()}>
    <SoulPage /></ClientStateProvider></ApiProvider>);
  return fake;
}
it('Soul 按三节显示系统默认；改一句后展示用户来源，撤销恢复原文来源', async () => {
  setup();
  await screen.findByRole('heading', { name: '主线的 Soul' });
  const section = screen.getByRole('region', { name: '说话' });
  expect(within(section).getAllByText('系统默认')).toHaveLength(3);
  fireEvent.click(within(section).getByRole('button', { name: '编辑：直接讲内容，先说结论。' }));
  fireEvent.change(screen.getByRole('textbox', { name: '规则内容' }), { target: { value: '先用一句话说结论。' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  const row = await screen.findByRole('listitem', { name: '先用一句话说结论。' });
  expect(within(row).getByText('你改的')).toBeTruthy();
  fireEvent.click(within(row).getByRole('button', { name: '撤销' }));
  expect(await screen.findByRole('button', { name: '编辑：直接讲内容，先说结论。' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '改动记录' }));
  expect(await screen.findByRole('region', { name: '改动记录' })).toBeTruthy();
});
it('添加规则选择小节；回执丢失后沿用同一请求核实，不重复添加', async () => {
  const fake = setup();
  await screen.findByRole('heading', { name: '主线的 Soul' });
  fireEvent.click(screen.getByRole('button', { name: '加一条' }));
  fireEvent.change(screen.getByRole('textbox', { name: '规则内容' }), { target: { value: '发出前核对收件人' } });
  fireEvent.change(screen.getByRole('combobox', { name: '所属小节' }), { target: { value: 'outbound' } });
  fake.control.faults.next('save', { kind: 'uncertain', landed: true });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  fireEvent.click(await screen.findByRole('button', { name: '再核实' }));
  expect(await within(screen.getByRole('region', { name: '对外' })).findByRole('button',
    { name: '编辑：发出前核对收件人' })).toBeTruthy();
  expect((await fake.api.soul.get()).lines.filter((line) => line.text === '发出前核对收件人')).toHaveLength(1);
});

it('队友独有规则可编辑并保留旧文本；主线修改即时出现在继承区', async () => {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试设备');
  const mate = await fake.api.mates.create({ requestId: 'mate-soul-fixture', name: '资料编辑', avatar: '编',
    hue: 'sky', role: '核对资料并整理', soul: '旧规则：先看原始资料。', purpose: null });
  render(<ApiProvider api={fake.api}><ClientStateProvider state={createClientState()}>
    <SoulPage mateId={mate.id} /></ClientStateProvider></ApiProvider>);
  await screen.findByRole('heading', { name: '主线的 Soul' });
  const aside = await screen.findByRole('complementary', { name: '队友的 Soul' });
  fireEvent.click(await within(aside).findByRole('button', { name: '编辑队友队友独有' }));
  expect((screen.getByRole('textbox', { name: '队友独有' }) as HTMLTextAreaElement).value)
    .toBe('旧规则：先看原始资料。');
  fireEvent.change(screen.getByRole('textbox', { name: '队友独有' }), { target: { value: '每次给出原始资料链接。' } });
  fireEvent.click(screen.getByRole('button', { name: '保存队友 Soul' }));
  expect(await within(aside).findByText('每次给出原始资料链接。')).toBeTruthy();
  expect((await fake.api.mates.get(mate.id)).soul).toContain('## 队友独有\n每次给出原始资料链接。');
  fireEvent.click(screen.getByRole('button', { name: '编辑：直接讲内容，先说结论。' }));
  fireEvent.change(screen.getByRole('textbox', { name: '规则内容' }), { target: { value: '先给一句结论。' } });
  fireEvent.click(screen.getByRole('button', { name: '保存规则' }));
  expect(await within(aside).findByText('先给一句结论。')).toBeTruthy();
});
