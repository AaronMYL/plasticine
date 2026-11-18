// 资料库导出弹框（11-18 设计稿 ExportDialog）：标题「导出「名字」」或「导出 n 篇」，一行格式分段（HTML · PDF ·
// Markdown · Word · 长图），记住上次选的；底部「取消 · 导出」，导出时按钮里转圈。做完关掉、存到这台设备，底部说一句；
// 没做成在框里写一行红字，可以再点。电脑上居中，手机上贴底成抽屉（dialog.css）。

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { SpaceExportFormat } from '../../api/shared.ts';
import { BusyText } from '../../primitives/busy/index.tsx';
import { showToast } from '../../primitives/toast/index.tsx';
import { saveFile } from '../../shell/save-file.ts';
import { exportSpaceFiles, SPACE_EXPORT_CHOICES } from './space-export.ts';
import '../../shell/dialog.css';
import './transfer.css';

const FORMAT_KEY = 'plasticine:space-export-format';

function rememberedFormat(): SpaceExportFormat {
  try {
    const saved = localStorage.getItem(FORMAT_KEY);
    return SPACE_EXPORT_CHOICES.find((choice) => choice.format === saved)?.format ?? 'html';
  } catch (cause) {
    console.warn('上次选的导出格式没读到，用网页。', cause);
    return 'html';
  }
}

function remember(format: SpaceExportFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, format);
  } catch (cause) {
    console.warn('导出格式没记住，下次再选。', cause);
  }
}

export interface ExportItem {
  id: string;
  title: string;
}

export function SpaceExportDialog({ items, onClose }: { items: readonly ExportItem[]; onClose: () => void })
  : ReactNode {
  const api = useApi();
  const titleId = useId();
  const [format, setFormat] = useState<SpaceExportFormat>(rememberedFormat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const before = document.activeElement;
    confirm.current?.focus({ focusVisible: false });
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ focusVisible: false });
    };
  }, []);
  const first = items[0];
  const title = items.length === 1 && first !== undefined ? `导出「${first.title}」` : `导出 ${items.length} 篇`;
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    remember(format);
    try {
      const file = await exportSpaceFiles(api, items, format);
      saveFile(file);
      showToast({ text: `已导出：${file.name}` });
      onClose();
    } catch (cause) {
      setError(`没导出：${errorText(cause)}`);
      setBusy(false);
    }
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  return createPortal(
    <div className="dialog-layer" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="dialog transfer-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={keys}>
        <h2 id={titleId} className="dialog-title">{title}</h2>
        <div className="segmented transfer-formats" role="group" aria-label="格式">
          {SPACE_EXPORT_CHOICES.map((choice) => <button key={choice.format} type="button" className="segmented-item"
            aria-pressed={format === choice.format} disabled={busy}
            onClick={() => setFormat(choice.format)}>{choice.label}</button>)}
        </div>
        {error === null ? null : <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
          <button ref={confirm} type="button" className="primary-button" disabled={busy}
            onClick={() => void run()}>
            <BusyText busy={busy} label="正在导出">{items.length > 1 ? `导出 ${items.length} 篇` : '导出'}</BusyText>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
