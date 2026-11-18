// 导入用的选文件框：一个看不见的 <input type="file">，点菜单里的「导入…」时打开系统的选文件框。

import { useRef, type ReactNode } from 'react';

export interface FilePicker {
  /** 打开选文件框。 */
  open: () => void;
  /** 那个看不见的输入框：放在页面里任何地方。 */
  input: ReactNode;
}

export function useFilePicker(options: { accept: string; label: string; onFiles: (files: File[]) => void })
  : FilePicker {
  const ref = useRef<HTMLInputElement>(null);
  const input = <input ref={ref} type="file" hidden multiple accept={options.accept} aria-label={options.label}
    onChange={(event) => {
      const files = [...(event.currentTarget.files ?? [])];
      // 清掉：同一批文件再选一次也要触发。
      event.currentTarget.value = '';
      if (files.length > 0) options.onFiles(files);
    }} />;
  return { open: () => ref.current?.click(), input };
}
