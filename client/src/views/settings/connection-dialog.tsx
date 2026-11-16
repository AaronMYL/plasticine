// 「添加连接」「编辑连接」的居中小弹框（11-16 设计稿）：名字、连接地址、令牌（只进不出：编辑时空着就是不改）。
// 「测试连接」先存一份再拿一遍工具清单（服务端加完就测），旁边写「拿到 n 个工具」或没连上的原因；底部「取消 · 保存」
// 靠右。新加的在这里测过、又点了「取消」，就把刚存的那份删掉，等于没加。

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { CONNECTION_NAME_MAX, type ConnectionView } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import '../../shell/dialog.css';

export interface ConnectionDialogProps {
  /** 编辑哪一个；null 是新加。 */
  connection: ConnectionView | null;
  onSaved: (connection: ConnectionView) => void;
  onRemoved: (id: string) => void;
  onClose: () => void;
}

const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

function resultText(connection: ConnectionView): string {
  return connection.status === 'ok' ? `拿到 ${connection.tools.length} 个工具` : `没连上：${connection.error ?? '对面没回'}`;
}

export function ConnectionDialog({ connection, onSaved, onRemoved, onClose }: ConnectionDialogProps): ReactNode {
  const api = useApi();
  const titleId = useId();
  const [name, setName] = useState(connection?.name ?? '');
  const [url, setUrl] = useState(connection?.url ?? '');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<ConnectionView | null>(connection);
  /** 这个框里新存下的（取消时删掉）。 */
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<ConnectionView | null>(null);
  const cleanUrl = url.trim();
  const cleanToken = token.trim();
  const valid = name.trim() !== '' && cleanUrl.startsWith('https://') && cleanUrl.length >= 8
    && (cleanToken === '' || TOKEN_PATTERN.test(cleanToken));
  /** 存一份：新的就加，有了就改（改了地址或令牌服务端会重测）。 */
  const store = async (): Promise<ConnectionView> => {
    if (saved === null) {
      const next = await api.connections.create({ requestId: createRequestId(), name: name.trim(), url: cleanUrl,
        ...(cleanToken === '' ? {} : { token: cleanToken }) });
      setCreated(next.id);
      return next;
    }
    return api.connections.update(saved.id, { requestId: createRequestId(), name: name.trim(), url: cleanUrl,
      ...(cleanToken === '' ? {} : { token: cleanToken }) });
  };
  const run = (what: 'test' | 'save', after: (next: ConnectionView) => void): void => {
    setBusy(what);
    setError(null);
    store().then(async (stored) => {
      const next = what === 'test' && stored.status === 'untested' ? await api.connections.test(stored.id) : stored;
      setSaved(next);
      setToken('');
      onSaved(next);
      after(next);
    }).catch((cause: unknown) => setError(errorText(cause))).finally(() => setBusy(null));
  };
  const cancel = (): void => {
    if (created !== null) {
      void api.connections.remove(created).then(() => onRemoved(created), () => undefined);
    }
    onClose();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (valid && busy === null) run('save', () => onClose());
  };
  // 挂到 body：设置弹框里面是另一层，遮罩要盖住整个窗口。
  return createPortal(
    <div className="dialog-layer" role="presentation" onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      // 设置弹框也认 Esc：这里收了就不再往外传。
      event.preventDefault();
      event.stopPropagation();
      if (busy === null) cancel();
    }}>
      <form className="dialog conn-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <h2 id={titleId} className="dialog-title">{connection === null ? '添加连接' : `编辑「${connection.name}」`}</h2>
        <label className="conn-field">
          <span className="conn-label">名字</span>
          <input className="field-input" value={name} maxLength={CONNECTION_NAME_MAX} autoFocus placeholder="比如 Notion"
            onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <label className="conn-field">
          <span className="conn-label">连接地址</span>
          <input className="field-input field-input-mono" value={url} inputMode="url" spellCheck={false}
            placeholder="https://…/mcp" onChange={(event) => setUrl(event.currentTarget.value)} />
        </label>
        <label className="conn-field">
          <span className="conn-label">令牌</span>
          <input className="field-input field-input-mono" type="password" autoComplete="off" value={token}
            placeholder={saved?.hasToken === true ? '已填，要换就填新的' : '没有就空着'}
            onChange={(event) => setToken(event.currentTarget.value)} />
        </label>
        {cleanToken !== '' && !TOKEN_PATTERN.test(cleanToken) ? <p className="dialog-error">令牌里有空格或中文字符。</p>
          : null}
        {error === null ? null : <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions conn-dialog-actions">
          <button type="button" className="secondary-button" disabled={!valid || busy !== null}
            onClick={() => run('test', setTested)}>{busy === 'test' ? '正在测…' : '测试连接'}</button>
          {tested === null ? null : <span className="conn-test" role="status" data-ok={tested.status === 'ok'}>
            {tested.status === 'ok' ? <Icon name="check" size={14} /> : null}{resultText(tested)}</span>}
          <span className="conn-dialog-gap" />
          <button type="button" className="secondary-button" disabled={busy !== null} onClick={cancel}>取消</button>
          <button type="submit" className="primary-button" disabled={!valid || busy !== null}>
            {busy === 'save' ? '正在保存…' : '保存'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
