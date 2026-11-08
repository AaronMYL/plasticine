import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { NoteVersionText, NoteVersionView } from '../../api/shared.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useStore } from '../../state/use-store.ts';
import { noteExtensions } from './editor-extensions.ts';
import type { NoteSaver } from './note-saver.ts';
import { localTime } from '../device/format.ts';
import { useTimeZone } from '../../live.tsx';

function Preview({ markdown, label }: { markdown: string; label: string }): ReactNode {
  const editor = useEditor({
    extensions: noteExtensions(),
    content: markdown,
    contentType: 'markdown',
    editable: false,
    editorProps: { attributes: { class: 'note-prose', 'aria-label': label } },
  });
  return <EditorContent editor={editor} />;
}

export function NoteVersions({
  saver,
  onClose,
  onRestored,
}: {
  saver: NoteSaver;
  onClose: () => void;
  onRestored: () => void;
}): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const phone = useViewportWidth() < PHONE_BELOW;
  const note = saver.current();
  const saveState = useStore(saver.state);
  const [versions, setVersions] = useState<NoteVersionView[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<NoteVersionText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void api.noteVersions.versions(note.id, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setVersions(result.versions);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [api, note.id, note.version, refresh]);

  useEffect(() => {
    setPreview(null);
    setConfirm(false);
    if (selected === null) {
      return;
    }
    const controller = new AbortController();
    void api.noteVersions.version(note.id, selected, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setPreview(result);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [api, note.id, selected, refresh]);

  const restore = async (): Promise<void> => {
    if (preview === null || busy) {
      return;
    }
    setBusy(true);
    const restored = await saver.restore(preview.markdown, preview.version);
    onRestored();
    setBusy(false);
    if (restored) {
      setConfirm(false);
      setRefresh((value) => value + 1);
    } else {
      setError('尚未完成恢复。请先处理笔记的保存状态，再核实或重试。');
    }
  };

  return (
    <Sheet open variant={phone ? 'drawer' : 'panel'} title="笔记版本" onClose={onClose}>
      <div className="note-version-content">
        {error === null ? null : (
          <p role="alert" className="is-error">
            {error}
            <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>
              重新读取
            </button>
          </p>
        )}
        <div className="note-version-list">
          {versions.map((version) => (
            <button
              type="button"
              className="text-button"
              key={version.version}
              aria-label={`查看第 ${version.version} 版`}
              onClick={() => setSelected(version.version)}
            >
              第 {version.version} 版 · <time className="text-meta">{localTime(version.savedAt, timeZone)}</time> ·
              {version.author === 'user' ? '你保存的' : 'Plasticine 写的'} · {version.characters ?? '—'} 字
              {version.restoredFromVersion == null ? '' : ` · 恢复自第 ${version.restoredFromVersion} 版`}
            </button>
          ))}
        </div>
        {preview === null ? (
          <p className="sheet-note">选择一版查看正文。</p>
        ) : (
          <>
            <h3>历史正文 · 第 {preview.version} 版</h3>
            <Preview key={`history:${preview.version}`} markdown={preview.markdown} label="历史正文" />
            <details>
              <summary>对照当前草稿</summary>
              <Preview key={`current:${note.version}`} markdown={saver.initialMarkdown()} label="当前正文" />
            </details>
            {note.readOnly ? null : (
              <button type="button" className="chip-button" disabled={busy} onClick={() => setConfirm(true)}>
                以此版恢复
              </button>
            )}
            {!confirm ? null : (
              <div className="ask-card">
                <div className="ask-card-head">
                  <span className="tag tag-outline">要你确认</span>
                </div>
                <p className="ask-question">恢复到第 {preview.version} 版？会先保存当前草稿，已有版本都会保留。</p>
                <div className="ask-options">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || saveState.status === 'conflict'}
                    onClick={() => void restore()}
                  >
                    确认恢复
                  </button>
                  <button type="button" className="text-button" onClick={() => setConfirm(false)}>
                    先不
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
