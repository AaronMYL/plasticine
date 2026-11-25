import type { ReactNode } from 'react';
import type { SkippedFileView } from '../../api/shared.ts';
import '../bulk/bulk.css';
import './transfer.css';

export function SkippedFiles({ files, onClose }: { files: readonly SkippedFileView[]; onClose: () => void })
  : ReactNode {
  if (files.length === 0) return null;
  return <div className="bulk-feedback transfer-skipped" data-failed="true" role="alert">
    <div><p>{`有 ${files.length} 个文件没导入`}</p>
      <ul>{files.map((file, index) => <li key={`${index}:${file.name}`}>「{file.name}」：{file.reason}</li>)}</ul></div>
    <button type="button" className="text-button" onClick={onClose}>知道了</button>
  </div>;
}
