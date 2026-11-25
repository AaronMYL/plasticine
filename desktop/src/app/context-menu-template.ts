export interface MenuParams {
  x: number;
  y: number;
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  srcURL: string;
  mediaType: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export type MenuRole = 'cut' | 'copy' | 'paste' | 'selectAll';

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'role'; role: MenuRole; label: string; enabled: boolean }
  | { kind: 'action'; id: MenuAction; label: string; accelerator?: string; value?: string };

export type MenuAction = 'quote' | 'replaceMisspelling' | 'copyLink' | 'copyImage' | 'copyImageAddress';

export const QUOTE_ACCELERATOR = 'CmdOrCtrl+Shift+L';
const MAX_SUGGESTIONS = 4;

function trimSeparators(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'separator' && (out.length === 0 || out[out.length - 1]?.kind === 'separator')) continue;
    out.push(entry);
  }
  while (out[out.length - 1]?.kind === 'separator') out.pop();
  return out;
}

export function contextMenuEntries(params: MenuParams): MenuEntry[] {
  const selected = params.selectionText.trim() !== '';
  const entries: MenuEntry[] = [];
  if (params.isEditable && params.misspelledWord !== '') {
    for (const word of params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)) {
      entries.push({ kind: 'action', id: 'replaceMisspelling', label: word, value: word });
    }
    entries.push({ kind: 'separator' });
  }
  if (selected) {
    entries.push({ kind: 'action', id: 'quote', label: '引用到对话', accelerator: QUOTE_ACCELERATOR },
      { kind: 'separator' });
  }
  if (params.isEditable) {
    entries.push({ kind: 'role', role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
      { kind: 'role', role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
      { kind: 'role', role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
      { kind: 'separator' },
      { kind: 'role', role: 'selectAll', label: '全选', enabled: params.editFlags.canSelectAll });
  } else if (selected) {
    entries.push({ kind: 'role', role: 'copy', label: '复制', enabled: true });
  }
  if (params.linkURL !== '') {
    entries.push({ kind: 'separator' }, { kind: 'action', id: 'copyLink', label: '复制链接地址', value: params.linkURL });
  }
  if (params.mediaType === 'image' && params.srcURL !== '') {
    entries.push({ kind: 'separator' }, { kind: 'action', id: 'copyImage', label: '复制图片' },
      { kind: 'action', id: 'copyImageAddress', label: '复制图片地址', value: params.srcURL });
  }
  return trimSeparators(entries);
}
