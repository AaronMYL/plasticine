import { useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { InboxFeedbackRequest } from '../../api/shared.ts';
import { useSettingsDraft } from './settings-dialog-context.ts';

const DRAFT = 'feedback:text';
const REQUEST = 'feedback:request';

export function FeedbackSection(): ReactNode {
  const api = useApi();
  const { inlineDrafts } = useClientState();
  useStore(inlineDrafts.store);
  const text = inlineDrafts.get(DRAFT);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useSettingsDraft(!busy && text.trim() !== '', () => inlineDrafts.clear(DRAFT));
  const save = async (): Promise<void> => {
    if (pending.current || text.trim() === '') { return; }
    pending.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const stored = inlineDrafts.get(REQUEST);
      const previous = stored === '' ? null : JSON.parse(stored) as InboxFeedbackRequest;
      const input = previous?.text === text ? previous : { requestId: createRequestId(), text };
      inlineDrafts.set(REQUEST, JSON.stringify(input));
      await api.inbox.feedback(input);
      inlineDrafts.clearIfSent(DRAFT, input.text);
      inlineDrafts.clear(REQUEST);
      // 站内信页并进了消息（11-04），反馈不再有单独一页可看；只说存下了。
      setStatus('已存下这条反馈。');
    } catch (cause) { setError(errorText(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="block" aria-label="提建议或反馈">
    <h3 className="block-title">提建议或反馈</h3>
    <label className="field"><span className="field-label">你的原话</span>
      <textarea className="field-input" rows={3} maxLength={10000} value={text} readOnly={busy}
        onChange={(event) => inlineDrafts.set(DRAFT, event.target.value)} /></label>
    <button type="button" className="chip-button" disabled={busy || text.trim() === ''}
      onClick={() => void save()}>{busy ? '正在保存…' : error === '' ? '存到反馈' : '重试保存'}</button>
    {status === '' ? null : <p role="status">{status}</p>}
    {error === '' ? null : <p role="alert">{error}</p>}
  </section>;
}
