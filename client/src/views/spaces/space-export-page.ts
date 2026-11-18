// 空间导出成网页（11-18 设计稿：HTML 是单个文件，离线能开）、再交出去出 PDF 和长图的那一页：和页面上看到的同一套版式
// （space-document.ts 套好、space-compose.ts 拼整页：样式、目录、图表的脚本都在里面），浅色；插图读好换成 data: 地址，
// 不用等外面传字体（没带 Geist、文楷，用系统字体）。最后带一份原样的空间，再导入回来一字不差。

import { spaceMarkerScript, type SpaceView } from '../../api/shared.ts';
import { blobBase64 } from '../../api/base64.ts';
import { bodyDate } from '../../shell/time-text.ts';
import { composeSpaceDocument } from './space-compose.ts';
import { prepareSpace } from './space-document.ts';

/** 打印成 PDF 时：吸顶的目录不要，卡片、图、表格不从中间断开。 */
const PRINT_CSS = '<style>@page{size:A4;margin:14mm}@media print{.rp-nav{display:none}'
  + 'figure,table,.rp-stat,.rp-pulse,.rp-points>*,.rp-cases>*,.rp-steps>*,.rcard{break-inside:avoid}}</style>';

/** 旧版式（还没重写成网页）的空间出不了网页、PDF、长图。 */
export class LegacySpaceError extends Error {}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function inlineAssets(body: string, readAsset: (path: string) => Promise<Blob>): Promise<string> {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${body}</body>`, 'text/html');
  const images = [...doc.body.querySelectorAll<HTMLImageElement>('img[data-pz-asset]')];
  const cache = new Map<string, Promise<string>>();
  await Promise.all(images.map(async (image) => {
    const path = image.dataset['pzAsset'] ?? '';
    let data = cache.get(path);
    if (data === undefined) {
      data = readAsset(path).then(async (blob) => `data:${blob.type || 'image/png'};base64,${await blobBase64(blob)}`);
      cache.set(path, data);
    }
    image.setAttribute('src', await data);
    image.removeAttribute('data-pz-asset');
  }));
  return doc.body.innerHTML;
}

export async function spaceExportHtml(space: SpaceView, readAsset: (path: string) => Promise<Blob>): Promise<string> {
  if (space.html === null || space.genre === null) {
    throw new LegacySpaceError(`「${space.title}」还是旧版式，先让 Plasticine 重排一次，再导出网页、PDF 或长图`);
  }
  const prepared = prepareSpace({ html: space.html, genre: space.genre, title: space.title,
    dateLabel: bodyDate(space.createdAt) });
  const body = await inlineAssets(prepared.body, readAsset);
  const page = composeSpaceDocument({ body, genre: space.genre, mode: 'page', tokens: {}, dark: false })
    .replace(' pz-wait', '')
    .replace('<head>', `<head><title>${escapeText(space.title)}</title>`)
    .replace('</head>', `${PRINT_CSS}</head>`);
  const marker = spaceMarkerScript({ title: space.title, genre: space.genre, html: space.html });
  return page.replace(/<\/body><\/html>$/, `${marker}</body></html>`);
}
