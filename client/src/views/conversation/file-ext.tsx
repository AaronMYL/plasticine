import type { ReactNode } from 'react';

export function attachmentExt(name: string, mime: string): string {
  const dot = name.lastIndexOf('.');
  const fromName = dot > 0 ? name.slice(dot + 1) : '';
  if (/^[A-Za-z0-9]{1,5}$/.test(fromName)) return fromName.toUpperCase();
  const subtype = mime.split('/')[1] ?? '';
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype.toUpperCase() : '文件';
}

export function FileExt({ name, mime, small = false }: { name: string; mime: string; small?: boolean }):
  ReactNode {
  return <span className="file-ext" data-small={small} aria-hidden="true">
    {small ? null : attachmentExt(name, mime)}</span>;
}
