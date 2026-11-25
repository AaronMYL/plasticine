import { useRef, type ReactNode } from 'react';

export interface FilePicker {
  open: () => void;
  input: ReactNode;
}

export function useFilePicker(options: { accept: string; label: string; onFiles: (files: File[]) => void })
  : FilePicker {
  const ref = useRef<HTMLInputElement>(null);
  const input = <input ref={ref} type="file" hidden multiple accept={options.accept} aria-label={options.label}
    onChange={(event) => {
      const files = [...(event.currentTarget.files ?? [])];
      event.currentTarget.value = '';
      if (files.length > 0) options.onFiles(files);
    }} />;
  return { open: () => ref.current?.click(), input };
}
