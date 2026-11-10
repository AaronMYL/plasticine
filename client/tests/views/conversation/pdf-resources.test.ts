import { afterEach, expect, it, vi } from 'vitest';
import { LocalPdfResources } from '../../../src/views/conversation/pdf-resources.ts';

afterEach(() => vi.restoreAllMocks());

it('PDF只能取安装包中列出的资源，不能把文件名或资源种类变成远程请求', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const resources = new LocalPdfResources();
  await expect(resources.fetch({ kind: 'url', filename: 'https://example.test/font.ttf' })).rejects.toThrow();
  await expect(resources.fetch({ kind: 'standardFontDataUrl', filename: '../../private' })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(await resources.fetch({ kind: 'standardFontDataUrl', filename: 'LiberationSans-Regular.ttf' }))
    .toEqual(new Uint8Array([1, 2, 3]));
  expect(String(fetch.mock.calls[0]?.[0])).not.toMatch(/^https?:/);
});
