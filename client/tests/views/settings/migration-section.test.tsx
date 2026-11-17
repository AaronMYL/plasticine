// 设置 · 系统「数据迁移」（11-16 设计稿）：导出两种（全部要口令两遍、只要数据的没有口令框），好了能下载；
// 选文件马上传，加了密的输口令（不对就地说），核对后选合并（默认）或替换（红色说清楚），选好盖住整页等重启。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function section(): Promise<HTMLElement> {
  const pane = await screen.findByRole('dialog', { name: '设置' });
  return within(pane).findByRole('region', { name: '数据迁移' });
}

function pick(region: HTMLElement, name: string): void {
  const input = within(region).getByLabelText('选迁移文件');
  fireEvent.change(input, { target: { files: [new File(['fake'], name, { type: 'application/octet-stream' })] } });
}

describe('数据迁移', () => {
  it('导出：默认全部、口令两遍对上才能开始；只要数据的没有口令框；打包完出「下载」', async () => {
    const app = await renderApp({ hash: '#/settings/system' });
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: '导出…' }));
    const dialog = await screen.findByRole('dialog', { name: '导出' });
    expect((within(dialog).getByRole('radio', { name: /全部导出/ }) as HTMLInputElement).checked).toBe(true);
    const start = within(dialog).getByRole('button', { name: '开始导出' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('口令'), { target: { value: 'fake pass 1' } });
    fireEvent.change(within(dialog).getByLabelText('再输一次'), { target: { value: 'fake pass 2' } });
    expect(within(dialog).getByText('两次不一样。')).toBeTruthy();
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /只导出数据/ }));
    expect(within(dialog).queryByLabelText('口令')).toBeNull();
    const exported = vi.spyOn(app.api.migration, 'startExport');
    fireEvent.click(start);
    await waitFor(() => expect(exported).toHaveBeenCalledWith('data', null));
    await waitFor(() => expect(within(region).getByRole('link', { name: '下载' })).toBeTruthy(),
      { timeout: 8_000 });
    expect(within(region).getByText('没加密')).toBeTruthy();
  });

  it('导入：传完要口令，不对就地说；对了核对、默认合并；改选替换出红色后果；选好盖住整页', async () => {
    await renderApp({ hash: '#/settings/system' });
    const region = await section();
    pick(region, 'from-old-server.plasticine');
    const asking = await screen.findByRole('dialog', { name: '从另一台导入' });
    const field = await within(asking).findByLabelText('导出时设的口令', {}, { timeout: 3_000 });
    fireEvent.change(field, { target: { value: 'wrong one' } });
    fireEvent.click(within(asking).getByRole('button', { name: '核对' }));
    expect(await within(asking).findByText('口令不对，再试一次。')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'the right one' } });
    fireEvent.click(within(asking).getByRole('button', { name: '核对' }));
    const check = await screen.findByRole('dialog', { name: '导入这一份' });
    expect(within(check).getByText('@linyu')).toBeTruthy();
    expect((within(check).getByRole('radio', { name: /合并/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(check).getByRole('button', { name: '合并并重启' })).toBeTruthy();
    fireEvent.click(within(check).getByRole('radio', { name: /替换/ }));
    expect(within(check).getByText('这台原来的数据会整个换掉。')).toBeTruthy();
    fireEvent.click(within(check).getByRole('button', { name: '替换并重启' }));
    expect(await screen.findByRole('alertdialog', { name: '正在替换，Plasticine 马上重启' })).toBeTruthy();
  });

  it('更新的版本导出的：在原处说先更新这台，只给「关掉」', async () => {
    await renderApp({ hash: '#/settings/system' });
    const region = await section();
    pick(region, 'from-new-version.plasticine');
    const dialog = await screen.findByRole('dialog', { name: '从另一台导入' });
    expect(await within(dialog).findByText(/先在设置 · 系统里更新这台/, {}, { timeout: 3_000 })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '关掉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '从另一台导入' })).toBeNull());
  });
});
