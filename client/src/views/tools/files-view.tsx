// 文件（工具组的一项，《UI 方案》第 9 节）：状态目录里的工作目录。一层一层点进去；文件可以下载、上传（按类型和大小收，
// 服务端再核）、新建文件夹；改名 / 移动、删除都要打一遍现在的名字（删除进回收，回收里能还原）。确认那一句和新名字存在
// inline-drafts。读失败说原因并给「重新读取」。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { FileEntryView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { PendingOps } from '../pending/pending-ops.tsx';
import { FOLDER_DRAFT } from '../m5b/m5b-actions.ts';
import { LoadNote, shortTime } from '../m5b/load-note.tsx';
import './tools.css';
import { FileTextEditor } from './file-text-editor.tsx';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';

// 一个文件最多 20 MB（服务端 FILE_UPLOAD_MAX_BYTES）：大了先在这里拦，不白传。
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

function bytesText(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function draftKey(entry: FileEntryView, what: 'to' | 'confirm'): string {
  return `files:${entry.path}:${what}`;
}

function EntryActions({ entry, mode, onDone }: { entry: FileEntryView; mode: 'move' | 'trash'; onDone: () => void }) {
  const { m5bActions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const to = drafts.get(draftKey(entry, 'to')) ?? entry.path;
  const confirm = drafts.get(draftKey(entry, 'confirm')) ?? '';
  const submit = async (): Promise<void> => {
    const done = mode === 'move'
      ? await m5bActions.move(entry, to.trim(), confirm)
      : await m5bActions.trash(entry, confirm);
    if (!done) {
      return;
    }
    inlineDrafts.clear(draftKey(entry, 'to'));
    inlineDrafts.clear(draftKey(entry, 'confirm'));
    onDone();
  };
  return (
    <div
      className="tool-confirm"
      role="group"
      aria-label={mode === 'move' ? `改名或移动「${entry.name}」` : `删除「${entry.name}」`}
    >
      {mode === 'move' ? (
        <label className="field">
          <span className="field-label">新的位置</span>
          <input
            className="field-input field-input-mono"
            value={to}
            onChange={(event) => inlineDrafts.set(draftKey(entry, 'to'), event.target.value)}
          />
        </label>
      ) : null}
      <label className="field">
        <span className="field-label">打一遍「{entry.name}」确认</span>
        <input
          className="field-input"
          value={confirm}
          onChange={(event) => inlineDrafts.set(draftKey(entry, 'confirm'), event.target.value)}
        />
      </label>
      <button type="button" className="primary-button" disabled={confirm !== entry.name} onClick={() => void submit()}>
        {mode === 'move' ? '修改' : '删除（进回收）'}
      </button>
      <button type="button" className="text-button text-button-quiet" onClick={onDone}>
        不改了
      </button>
    </div>
  );
}

function Trash(): ReactNode {
  const { m5b, m5bActions } = useLive();
  const trash = useStore(m5b.trash.data);
  useEffect(() => {
    m5b.trash.open();
  }, [m5b.trash]);
  const entries = trash.value?.entries ?? [];
  return (
    <section className="block" aria-label="回收">
      <div className="block-head">
        <h3 className="block-title">回收</h3>
        <span className="block-meta text-mono">{entries.length}</span>
      </div>
      <LoadNote resource={trash} what="回收" onRetry={() => void m5b.trash.reload()} />
      {trash.status === 'ready' && entries.length === 0 ? <p className="block-empty">回收是空的。</p> : null}
      <ul className="tool-list">
        {entries.map((entry) => (
          <li key={entry.id} className="tool-row file-row">
            <span className="tool-row-main">{entry.originalPath}</span>
            <span className="file-row-side">
              <span className="tool-row-meta text-meta">{shortTime(entry.trashedAt)}</span>
              <IconButton icon="undo" label="还原" title={`还原 ${entry.originalPath}`}
                onClick={() => void m5bActions.restore(entry)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FilesView(): ReactNode {
  const api = useApi();
  const { m5b, m5bActions } = useLive();
  const { inlineDrafts } = useClientState();
  const files = useStore(m5b.files.data);
  const folder = useStore(m5b.folder);
  const newFolder = useStore(inlineDrafts.store).get(FOLDER_DRAFT) ?? '';
  const [editing, setEditing] = useState<{ path: string; mode: 'move' | 'trash' } | null>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState(folder);
  const [textFile, setTextFile] = useState<{ path: string; creating: boolean } | null>(null);
  const [newText, setNewText] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    m5b.files.open();
  }, [m5b.files]);
  const go = (path: string): void => {
    m5b.folder.set(path);
    setPathDraft(path);
    setEditing(null);
    void m5b.files.reset();
  };
  const listing = files.value;
  return (
    <div className="tool">
      <PendingOps
        label="还没了结的文件操作"
        prefixes={['files:']}
        visible={() => false}
        onRetry={(key) => void m5bActions.retry(key)}
      />
      <div className="tool-bar">
        <form className="file-path-form" onSubmit={(event) => { event.preventDefault(); go(pathDraft.trim()); }}>
          <input className="field-input" aria-label="文件路径" placeholder="工作目录或服务器绝对路径" value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)} />
          <button type="submit" className="text-button">前往</button>
        </form>
        {listing?.parent === null || listing === null ? null : (
          <IconButton icon="chevron-up" label="上一层" onClick={() => go(listing.parent ?? '')} />
        )}
        <span className="tool-bar-grow" />
        <IconButton icon="upload" label="上传" onClick={() => upload.current?.click()} />
        <input
          ref={upload}
          type="file"
          aria-label="上传文件"
          multiple
          hidden
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = '';
            setTooBig(null);
            void (async () => { for (const file of selected) {
              if (file.size > UPLOAD_MAX_BYTES) { setTooBig(`「${file.name}」超过 20 MB，没有传。`); continue; }
              await m5bActions.upload(folder, file);
            } })();
          }}
        />
      </div>
      <div className="tool-bar" aria-label="常用位置">
        {[['', '工作目录'], ['/', '服务器根目录'], ['/home', '用户目录'], ['/srv', '服务资料'], ['/var/log', '日志']]
          .map(([path = '', label]) => <button type="button" className="text-button" key={path}
            onClick={() => go(path)}>{label}</button>)}
      </div>
      {listing?.freeBytes === undefined ? null : <p className="text-meta">
        磁盘剩余 {(listing.freeBytes / 1024 ** 3).toFixed(1)} GB</p>}
      <details className="file-create">
        <summary><Icon name="plus" />新建文件或文件夹
          {newFolder === '' && newText === '' ? null : <span className="tag tag-neutral">草稿</span>}
        </summary>
        <form className="tool-form" onSubmit={(event) => {
          event.preventDefault();
          setTextFile({ path: `${folder}${folder.endsWith('/') || folder === '' ? '' : '/'}${newText}`,
            creating: true });
        }}><label className="field">新文本文件名<input className="field-input" value={newText}
          onChange={(event) => setNewText(event.target.value)} /></label>
          <button type="submit" className="chip-button" disabled={newText.trim() === ''}>新建文本</button></form>
        <section className="tool-form" aria-label="新建文件夹">
          <label className="field">
            <span className="field-label">新文件夹的名字</span>
            <input
              className="field-input"
              value={newFolder}
              onChange={(event) => inlineDrafts.set(FOLDER_DRAFT, event.target.value)}
            />
          </label>
          <button
            type="button"
            className="chip-button"
            disabled={newFolder.trim() === ''}
            onClick={() => void m5bActions.createFolder(folder)}
          >
            新建
          </button>
        </section>
      </details>
      {textFile === null ? null :
        <FileTextEditor key={textFile.path} {...textFile} onClose={() => setTextFile(null)} />}
      {tooBig === null ? null : <p className="tool-sub tool-error" role="alert">{tooBig}</p>}
      <LoadNote resource={files} what="文件夹" onRetry={() => void m5b.files.reload()} />
      {files.status === 'ready' && listing?.entries.length === 0 ? <p className="block-empty">这个文件夹是空的。</p> : null}
      <ul className="tool-list" aria-label="文件">
        {(listing?.entries ?? []).map((entry) => (
          <li key={entry.path} className="tool-row file-row" aria-label={entry.name}>
            {entry.kind === 'directory' ? (
              <button type="button" className="text-button tool-row-main" onClick={() => go(entry.path)}>
                <Icon name="folder" /> {entry.name}
              </button>
            ) : entry.type?.startsWith('text/')
              || /\.(?:md|txt|json|css|html|js|ts|tsx|yml|yaml|log|sh)$/i.test(entry.name) ? (
              <button type="button" className="text-button tool-row-main"
                onClick={() => setTextFile({ path: entry.path, creating: false })}>{entry.name}</button>
            ) : (
              <a className="text-button tool-row-main" href={api.files.downloadUrl(entry.path)} download={entry.name}>
                {entry.name}
              </a>
            )}
            <span className="file-row-side">
              <span className="tool-row-meta text-meta">{entry.kind === 'file' ? bytesText(entry.bytes) : '文件夹'}</span>
              <span className="tool-row-meta text-meta">{shortTime(entry.modifiedAt)}</span>
              <IconButton icon="edit" label="改名" title={`改名 ${entry.name}`}
                onClick={() => setEditing({ path: entry.path, mode: 'move' })} />
              <IconButton icon="trash" label="删除" title={`删除 ${entry.name}`}
                onClick={() => setEditing({ path: entry.path, mode: 'trash' })} />
            </span>
            {editing?.path === entry.path ? (
              <EntryActions entry={entry} mode={editing.mode} onDone={() => setEditing(null)} />
            ) : null}
          </li>
        ))}
      </ul>
      <Trash />
    </div>
  );
}
