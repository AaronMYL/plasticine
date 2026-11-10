// 复用工作区已锁定的 PDF.js；资源都随 Vite 打包，PDF 里的网址不能成为字体或解码器地址。
const assets = import.meta.glob<string>([
  '../../../../node_modules/pdfjs-dist/cmaps/*.bcmap',
  '../../../../node_modules/pdfjs-dist/standard_fonts/*.{ttf,pfb}',
  '../../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm',
], { query: '?url', import: 'default', eager: true });

const CATEGORIES: Readonly<Record<string, string>> = {
  cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm',
};

export class LocalPdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const folder = CATEGORIES[kind];
    const source = folder === undefined ? undefined
      : assets[`../../../../node_modules/pdfjs-dist/${folder}/${filename}`];
    if (source === undefined) throw new Error('PDF 所需资源未随安装包提供。');
    const response = await fetch(source, { credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) throw new Error('PDF 本地资源读取失败，请重新打开文件。');
    return new Uint8Array(await response.arrayBuffer());
  }
}
