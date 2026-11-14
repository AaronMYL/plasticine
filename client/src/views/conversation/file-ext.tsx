import type { ReactNode } from 'react';

/** 附件的后缀（大写、最多 5 个字母数字）：名字里没有就看类型；都看不出写「文件」。 */
export function attachmentExt(name: string, mime: string): string {
  const dot = name.lastIndexOf('.');
  const fromName = dot > 0 ? name.slice(dot + 1) : '';
  if (/^[A-Za-z0-9]{1,5}$/.test(fromName)) return fromName.toUpperCase();
  const subtype = mime.split('/')[1] ?? '';
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype.toUpperCase() : '文件';
}

/** 折角的文件图标，上面写后缀（第13批附件任意类型）；小的（待发小条里）只有形状，后缀在旁边的名字里。 */
export function FileExt({ name, mime, small = false }: { name: string; mime: string; small?: boolean }):
  ReactNode {
  return <span className="file-ext" data-small={small} aria-hidden="true">
    {small ? null : attachmentExt(name, mime)}</span>;
}
