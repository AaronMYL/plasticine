// 「导出…」的居中小弹框（11-16 设计稿）：两种选一种——只导出数据（不带密钥、登录和地址，不要口令，不加密）、
// 全部导出（连同这些，口令两遍）。打开时停在上次选的那种（没选过是全部）。

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MIGRATION_PASSPHRASE_MIN, type MigrationMode } from '../../api/shared.ts';
import { BusyText } from '../../primitives/busy/index.tsx';
import '../../shell/dialog.css';
import './migration.css';

const LAST_MODE_KEY = 'plasticine.migration.exportMode';

function lastMode(): MigrationMode {
  try {
    return window.localStorage.getItem(LAST_MODE_KEY) === 'data' ? 'data' : 'full';
  } catch {
    return 'full';
  }
}

function rememberMode(mode: MigrationMode): void {
  try {
    window.localStorage.setItem(LAST_MODE_KEY, mode);
  } catch (cause) {
    // 存不下就算了：下次还是停在「全部导出」。
    console.warn('记不住上次选的导出方式', cause);
  }
}

export const ONLY_DATA_TEXT = '对话、记忆、笔记、文件、书、空间、技能都在；不带模型密钥、连接令牌、登录、设备和地址。'
  + '不用口令，文件不加密，自己收好。';
export const ALL_DATA_TEXT = '连同密钥、登录和地址一起；换服务器用这个。要设口令，文件用它加密。';

/** 一种选法：圈、名字、一句说明；整块能点。 */
export function MigrationOption({ name, value, checked, title, text, onSelect }: { name: string; value: string;
  checked: boolean; title: string; text: string; onSelect: () => void }): ReactNode {
  return (
    <label className="mig-option" data-selected={checked ? 'true' : 'false'}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} />
      <span className="mig-option-text">
        <span className="mig-option-title">{title}</span>
        <span className="mig-option-detail">{text}</span>
      </span>
    </label>
  );
}

export function MigrationExportDialog({ busy, error, onStart, onClose }: { busy: boolean; error: string | null;
  onStart: (mode: MigrationMode, passphrase: string | null) => void; onClose: () => void }): ReactNode {
  const titleId = useId();
  const group = useId();
  const [mode, setMode] = useState<MigrationMode>(lastMode);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const short = Array.from(first).length < MIGRATION_PASSPHRASE_MIN;
  const mismatch = second !== '' && first !== second;
  const ready = mode === 'data' || (!short && first === second);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || busy) return;
    rememberMode(mode);
    onStart(mode, mode === 'full' ? first : null);
  };
  return createPortal(
    <div className="dialog-layer" role="presentation" onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
    }}>
      <form className="dialog mig-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <h2 id={titleId} className="dialog-title">导出</h2>
        <div className="mig-options" role="radiogroup" aria-label="导出哪些">
          <MigrationOption name={group} value="data" checked={mode === 'data'} title="只导出数据" text={ONLY_DATA_TEXT}
            onSelect={() => setMode('data')} />
          <MigrationOption name={group} value="full" checked={mode === 'full'} title="全部导出" text={ALL_DATA_TEXT}
            onSelect={() => setMode('full')} />
        </div>
        {mode === 'full' ? <>
          <label className="mig-field">
            <span className="mig-label">口令</span>
            <input className="field-input field-input-mono" type="password" autoComplete="new-password" value={first}
              autoFocus onChange={(event) => setFirst(event.currentTarget.value)} />
          </label>
          <label className="mig-field">
            <span className="mig-label">再输一次</span>
            <input className="field-input field-input-mono" type="password" autoComplete="new-password" value={second}
              aria-invalid={mismatch} onChange={(event) => setSecond(event.currentTarget.value)} />
          </label>
          {mismatch ? <p className="dialog-error">两次不一样。</p>
            : <p className="dialog-text">口令丢了，这个文件就打不开；Plasticine 不留底。至少 {MIGRATION_PASSPHRASE_MIN} 位。</p>}
        </> : null}
        {error === null ? null : <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={!ready || busy}>
            <BusyText busy={busy} label="正在开始导出">开始导出</BusyText></button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
