import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadPage } from '../../src/views/download/download-page.tsx';
import { parseDownloadCatalog, existingInstanceUrl } from '../../src/views/download/release-catalog.ts';
import { setViewportWidth } from '../helpers.tsx';
import { releaseFixture } from './download-fixture.ts';

const MANIFEST = 'https://download.example.test/download/manifest.json';
beforeEach(() => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh'));

describe('公开下载页', () => {
  it('三平台的链接、版本和校验值都来自同一份真实清单；Linux 命令采用版本化安装脚本地址', async () => {
    setViewportWidth(1440);
    const manifest = releaseFixture();
    const read = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    render(<DownloadPage fetcher={read} manifestUrl={MANIFEST} />);
    const mac = await screen.findByRole('link', { name: '下载 Mac 版' });
    expect(mac.getAttribute('href')).toBe(new URL(manifest.assets.mac!.url, MANIFEST).href);
    expect(screen.getByText(manifest.version)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Windows' }));
    expect(screen.getByRole('link', { name: '下载 Windows 版' }).getAttribute('href'))
      .toBe(new URL(manifest.assets.windows!.url, MANIFEST).href);
    fireEvent.click(screen.getByRole('tab', { name: 'Linux' }));
    expect(screen.getByLabelText('Linux 安装命令').textContent)
      .toContain(new URL(manifest.assets.linuxInstaller.url, MANIFEST).href);
    fireEvent.click(screen.getByRole('button', { name: '校验文件' }));
    const checksums = screen.getByRole('region', { name: '校验文件' });
    expect(within(checksums).getAllByText('a'.repeat(64))).toHaveLength(4);
    expect(within(checksums).getByRole('link', { name: '发布清单' }).getAttribute('href')).toBe(MANIFEST);
    expect(within(checksums).getByRole('link', { name: 'plasticine-server.tar.gz' }).getAttribute('href'))
      .toBe(new URL(manifest.assets.server.url, MANIFEST).href);
    expect(read).toHaveBeenCalledWith(MANIFEST, expect.objectContaining({ cache: 'no-store' }));
  });

  it('读取失败不编造默认版本，提供重试；连接已有实例仍可操作', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFixture())));
    const navigate = vi.fn();
    render(<DownloadPage fetcher={read} manifestUrl={MANIFEST} navigate={navigate} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: '下载 Mac 版' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Plasticine 地址'), { target: { value: 'https://mine.example.test' } });
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    expect(navigate).toHaveBeenCalledWith('https://mine.example.test/');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByRole('link', { name: '下载 Mac 版' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('手机先显示连接已有实例；安装帮助在页内可读，不依赖私有仓库', async () => {
    setViewportWidth(390);
    render(<DownloadPage manifestUrl={MANIFEST}
      fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify(releaseFixture())))} />);
    await screen.findByRole('link', { name: '下载 Mac 版' });
    expect(screen.getByRole('heading', { level: 1, name: '在手机上使用' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 })[0]?.textContent).toBe('连接已有 Plasticine');
    fireEvent.click(screen.getByRole('button', { name: '安装说明' }));
    expect(screen.getByRole('region', { name: '安装与打开' }).textContent).toContain('应用程序');
  });

  it('加载中不提供伪下载链接，组件卸载会取消读取', async () => {
    const read = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined));
    const view = render(<DownloadPage fetcher={read} manifestUrl={MANIFEST} />);
    expect(screen.getByRole('status').textContent).toContain('正在读取安装包');
    expect(screen.queryByRole('link', { name: '下载 Mac 版' })).toBeNull();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const signal = (read.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('下载清单边界', () => {
  it('缺少四包之一、错误 SHA 或脚本协议都不能变成可点下载', () => {
    const missing = releaseFixture();
    delete missing.assets.windows;
    expect(() => parseDownloadCatalog(JSON.stringify(missing), MANIFEST)).toThrow();
    const malformed = releaseFixture();
    malformed.assets.server.sha256 = 'broken';
    expect(() => parseDownloadCatalog(JSON.stringify(malformed), MANIFEST)).toThrow();
    const unsafe = releaseFixture();
    unsafe.assets.mac!.url = 'javascript:alert(1)';
    expect(() => parseDownloadCatalog(JSON.stringify(unsafe), MANIFEST)).toThrow();
  });

  it('已有实例只接受网页地址，允许本机地址，不执行脚本或接受夹带凭据的 URL', () => {
    expect(existingInstanceUrl('mine.example.test')).toBe('https://mine.example.test/');
    expect(existingInstanceUrl('http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790/');
    expect(() => existingInstanceUrl('javascript:alert(1)')).toThrow();
    expect(() => existingInstanceUrl('https://user:secret@example.test')).toThrow();
  });
});
