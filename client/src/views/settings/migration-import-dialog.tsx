import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MigrationHow, MigrationImportView, MigrationSummary } from '../../api/shared.ts';
import { BusyText, Spinner } from '../../primitives/busy/index.tsx';
import { useTimeZone } from '../../live.tsx';
import { MigrationOption } from './migration-export-dialog.tsx';
import { fromText, sizeText, stampText } from './migration-text.ts';
import '../../shell/dialog.css';
import './migration.css';

export const MERGE_TEXT = '这台的都留着，把文件里这台没有的加进来；两边都有的同一条，留这台的。这台的设置、密钥和地址不动。';
export const REPLACE_TEXT = '这台的数据整个换成这一份。';

export interface ImportDialogProps {
  view: MigrationImportView;
  progress: number | null;
  busy: boolean;
  error: string | null;
  onUnlock: (passphrase: string) => void;
  onApply: (how: MigrationHow) => void;
  onCancel: () => void;
}

function Facts({ summary, timeZone }: { summary: MigrationSummary; timeZone: string }): ReactNode {
  const facts: Array<[string, string, boolean]> = [
    ['来自', fromText(summary.handle), true],
    ['导出于', stampText(summary.exportedAt, timeZone), true],
    ['内容', summary.mode === 'full' ? '全部（带密钥和地址）' : '只有数据', false],
    ['对话', `${summary.counts.lines} 段`, true],
    ['记忆', `${summary.counts.memory.toLocaleString('zh-CN')} 条`, true],
    ['笔记', `${summary.counts.notes} 篇`, true],
    ['文件', `${summary.counts.files.toLocaleString('zh-CN')} 个`, true],
    ['技能', `${summary.counts.skills} 个`, true],
    ['大小', sizeText(summary.bytes), true],
  ];
  return (
    <dl className="mig-facts" aria-label="这一份里有什么">
      {facts.map(([label, value, mono]) => (
        <div key={label} className="mig-fact">
          <dt>{label}</dt><dd className={mono ? 'mono' : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function replaceWarning(summary: MigrationSummary): ReactNode {
  if (summary.mode === 'data') {
    return <p className="mig-warn" role="note"><b>这台原来的数据会换成这一份。</b>
      {'这一份只有数据：这台的密钥、登录和地址留着不动。7 天内能退回。'}</p>;
  }
  const who = fromText(summary.handle);
  return <p className="mig-warn" role="note"><b>这台原来的数据会整个换掉。</b>
    {`导入后这台就是 ${who}（它的 @名字和地址跟过来），要用那台的密码登录；原来那台要关掉：两台同时开着会抢地址。`}
    {'7 天内能退回。'}</p>;
}

export function MigrationImportDialog(props: ImportDialogProps): ReactNode {
  const { view } = props;
  const titleId = useId();
  const group = useId();
  const timeZone = useTimeZone();
  const [how, setHow] = useState<MigrationHow>('merge');
  const [passphrase, setPassphrase] = useState('');
  const closable = !props.busy && view.state !== 'applying';
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (props.busy) return;
    if (view.state === 'locked' && passphrase !== '') props.onUnlock(passphrase);
    if (view.summary !== null && (view.state === 'staging' || view.state === 'staged')) props.onApply(how);
  };
  let body: ReactNode;
  let actions: ReactNode;
  if (view.state === 'uploading') {
    const fraction = props.progress ?? (view.bytes === 0 ? 0 : view.received / view.bytes);
    body = <>
      <p className="mig-upload"><Spinner label="正在上传" />正在上传 <span className="mono">{view.name}</span></p>
      <div className="mig-bar" role="progressbar" aria-label="上传进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}><i style={{ width: `${(fraction * 100).toFixed(1)}%` }} /></div>
      <span className="mig-caption mono">{sizeText(fraction * view.bytes)} / {sizeText(view.bytes)}</span>
    </>;
    actions = <button type="button" className="secondary-button" onClick={props.onCancel}>取消</button>;
  } else if (view.state === 'locked') {
    body = <>
      <span className="mig-caption">已上传 · <span className="mono">{sizeText(view.bytes)}</span> · 这一份加了密</span>
      <label className="mig-field">
        <span className="mig-label">导出时设的口令</span>
        <input className="field-input field-input-mono" type="password" autoComplete="off" value={passphrase} autoFocus
          aria-invalid={props.error !== null} onChange={(event) => setPassphrase(event.currentTarget.value)} />
      </label>
    </>;
    actions = <>
      <button type="button" className="secondary-button" disabled={props.busy} onClick={props.onCancel}>取消</button>
      <button type="submit" className="primary-button" disabled={passphrase === '' || props.busy}>
        <BusyText busy={props.busy} label="正在核对">核对</BusyText></button>
    </>;
  } else if (view.state === 'failed' || view.summary === null) {
    body = <p className="dialog-error" role="alert">{view.error ?? '导入没做成，重新选一次文件。'}</p>;
    actions = <button type="button" className="secondary-button" onClick={props.onCancel}>关掉</button>;
  } else {
    const summary = view.summary;
    body = <>
      <Facts summary={summary} timeZone={timeZone} />
      <div className="mig-options" role="radiogroup" aria-label="怎么导入">
        <MigrationOption name={group} value="merge" checked={how === 'merge'} title="合并" text={MERGE_TEXT}
          onSelect={() => setHow('merge')} />
        <MigrationOption name={group} value="replace" checked={how === 'replace'} title="替换" text={REPLACE_TEXT}
          onSelect={() => setHow('replace')} />
      </div>
      {how === 'merge' ? <p className="dialog-text">另一台的对话按「已归档」加进来，不在这台接着跑。导入前在这台留一份，7 天内能退回。</p>
        : replaceWarning(summary)}
    </>;
    actions = <>
      <button type="button" className="secondary-button" disabled={props.busy} onClick={props.onCancel}>取消</button>
      <button type="submit" className={how === 'merge' ? 'primary-button' : 'danger-button'} disabled={props.busy}>
        <BusyText busy={props.busy} label="正在开始">{how === 'merge' ? '合并并重启' : '替换并重启'}</BusyText></button>
    </>;
  }
  const title = view.summary !== null && view.state !== 'failed' ? '导入这一份' : '从另一台导入';
  return createPortal(
    <div className="dialog-layer" role="presentation" onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (closable) props.onCancel();
    }}>
      <form className="dialog mig-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <h2 id={titleId} className="dialog-title">{title}</h2>
        {body}
        {props.error === null || view.state === 'failed' ? null
          : <p className="dialog-error" role="alert">{props.error}</p>}
        <div className="dialog-actions">{actions}</div>
      </form>
    </div>,
    document.body,
  );
}
