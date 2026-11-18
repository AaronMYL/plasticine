// 资料库导出（11-18，用户定五种：网页、PDF、Markdown、Word、长图；多篇打一个 zip）：
// - Markdown、Word 由本体写（POST /v2/spaces/export）；
// - 网页由界面拼（space-export-page.ts）；PDF、长图把这一页交出去排：桌面客户端里交给壳（Electron 自己出），
//   网页版、手机交给本体（云端浏览器）。

import type { PlasticineApi } from '../../api/client.ts';
import type { DownloadedFile } from '../../api/client.ts';
import type { PlasticineDesktopBridge, SpaceExportFormat } from '../../api/shared.ts';
import { spaceExportHtml } from '../spaces/space-export-page.ts';
import { zipStore, type StoredFile } from './zip-store.ts';

export const SPACE_EXPORT_CHOICES: readonly { format: SpaceExportFormat; label: string }[] = [
  { format: 'html', label: 'HTML' }, { format: 'pdf', label: 'PDF' }, { format: 'markdown', label: 'Markdown' },
  { format: 'docx', label: 'Word' }, { format: 'png', label: '长图' },
];
const EXTENSIONS: Readonly<Record<'html' | 'pdf' | 'png', string>> = { html: 'html', pdf: 'pdf', png: 'png' };

type DesktopWindow = Window & { plasticineDesktop?: Partial<PlasticineDesktopBridge> };

/** 标题里文件系统不认的字换成空格，空的用「未命名」。 */
export function fileBase(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
  return Array.from(cleaned === '' ? '未命名' : cleaned).slice(0, 80).join('');
}

async function rendered(api: PlasticineApi, html: string, format: 'pdf' | 'png', name: string): Promise<Uint8Array> {
  const desktop = (window as DesktopWindow).plasticineDesktop?.render;
  if (desktop !== undefined) {
    const bytes: unknown = await desktop.page(html, format);
    if (!(bytes instanceof Uint8Array)) throw new Error('桌面客户端没交回文件，再试一次');
    return bytes;
  }
  const file = await api.spaces.render({ html, format, name });
  return new Uint8Array(await file.blob.arrayBuffer());
}

/** 这几篇导出成一个文件（一篇就是它自己，多篇是 zip）。 */
export async function exportSpaceFiles(api: PlasticineApi, items: readonly { id: string; title: string }[],
  format: SpaceExportFormat): Promise<DownloadedFile> {
  if (format === 'markdown' || format === 'docx') {
    return api.spaces.exportFiles(items.map((item) => item.id), format);
  }
  const used = new Set<string>();
  const files: StoredFile[] = [];
  for (const item of items) {
    const space = await api.spaces.get(item.id);
    const html = await spaceExportHtml(space, (path) => api.spaces.asset(path));
    const base = fileBase(space.title);
    let name = `${base}.${EXTENSIONS[format]}`;
    for (let index = 2; used.has(name.toLowerCase()); index += 1) name = `${base} ${index}.${EXTENSIONS[format]}`;
    used.add(name.toLowerCase());
    const data = format === 'html' ? new TextEncoder().encode(html) : await rendered(api, html, format, base);
    files.push({ name, data });
  }
  const single = files.length === 1 ? files[0] : undefined;
  if (single !== undefined) {
    const types = { html: 'text/html', pdf: 'application/pdf', png: 'image/png' } as const;
    return { name: single.name, blob: new Blob([single.data as BlobPart], { type: types[format] }) };
  }
  return { name: `Plasticine 资料库（${files.length} 篇）.zip`, blob: zipStore(files) };
}
