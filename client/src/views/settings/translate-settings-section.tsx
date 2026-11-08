// 网页翻译的语言、显示与词表；模型和思考强度集中在设置 · AI。
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import {
  TRANSLATE_TARGET_LABELS, TRANSLATE_TARGETS,
  type TranslateSettingsView, type TranslateTarget,
} from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { TRANSLATE_SETTINGS_CHANGED } from '../../shell/web-translate-context.tsx';
import { SectionHead } from './section-head.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';
import './translate-settings.css';

// 段头的说明：在哪里用、用词表做什么、改了什么时候生效。
const TRANSLATE_NOTE = '在 Mac 的网页标签里点地址栏右边的「文A」翻译；只发段落文字，同一段再看不再花额度。\n'
  + '用词表开着时，你的用词按记忆里的词表译。\n'
  + '保存后下一批译文生效，已经插在页面上的译文不变。';

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function TranslateSettingsSection(): ReactNode {
  const api = useApi();
  const [settings, setSettings] = useState<TranslateSettingsView | null>(null);
  const [draft, setDraft] = useState<TranslateSettingsView | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api.translate.settings(controller.signal).then((nextSettings) => {
        if (!controller.signal.aborted) {
          setSettings(nextSettings);
        }
      }, (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      });
    return () => controller.abort();
  }, [api, revision]);
  const current = draft ?? settings;
  // 改回和已保存的一样就不算改动（不让关弹框白问一句）。
  const changed = draft !== null && settings !== null && !same(draft, settings);
  useSettingsDraft(changed, () => { setDraft(null); setMessage(null); });
  const editSettings = (patch: Partial<TranslateSettingsView>): void => {
    if (current !== null) {
      setDraft({ ...current, ...patch });
      setMessage(null);
    }
  };
  const save = async (): Promise<void> => {
    if (settings === null || current === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!same(current, settings)) {
        setSettings(await api.translate.saveSettings(current));
      }
      setDraft(null);
      setMessage('已保存');
      window.dispatchEvent(new Event(TRANSLATE_SETTINGS_CHANGED));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="block settings-ai-choice translate-settings" aria-label="网页翻译"
      data-settings-focus="translate" tabIndex={-1}>
      <SectionHead title="网页翻译" tip={TRANSLATE_NOTE}>
        <IconButton icon="refresh" label="重新读取网页翻译设置" disabled={busy} onClick={() => {
          setDraft(null);
          setError(null);
          setMessage(null);
          setRevision((value) => value + 1);
        }} />
      </SectionHead>
      {current === null ? null : <>
        <div className="model-choice">
          <label>翻译成<select className="field-input" aria-label="翻译成" value={current.target}
            disabled={busy} onChange={(event) => editSettings({ target: event.target.value as TranslateTarget })}>
            {TRANSLATE_TARGETS.map((target) => <option key={target} value={target}>
              {TRANSLATE_TARGET_LABELS[target]}</option>)}
          </select></label>
          <div className="translate-settings-field">
            <span>显示</span>
            <div className="segmented" role="group" aria-label="显示">
              {(['bilingual', 'translation'] as const).map((display) => (
                <button key={display} type="button" className="segmented-item" disabled={busy}
                  aria-pressed={current.display === display} onClick={() => editSettings({ display })}>
                  {display === 'bilingual' ? '双语对照' : '只看译文'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="translate-settings-field">
          <span>用词表</span>
          <input type="checkbox" role="switch" aria-label="用词表" checked={current.glossary} disabled={busy}
            onChange={(event) => editSettings({ glossary: event.target.checked })} />
        </label>
        {current.alwaysSites.length === 0 ? null : (
          <div className="translate-settings-field translate-settings-wide">
            <span>总是翻译</span>
            <ul className="translate-sites" aria-label="总是翻译">
              {current.alwaysSites.map((site) => (
                <li key={site} className="translate-site">
                  <span>{site}</span>
                  <button type="button" className="translate-site-remove" aria-label={`不再总是翻译 ${site}`}
                    title="不再总是翻译" disabled={busy} onClick={() => editSettings({
                      alwaysSites: current.alwaysSites.filter((entry) => entry !== site) })}>
                    <Icon name="close" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" className="chip-button translate-settings-save" disabled={busy || !changed}
          aria-label="保存网页翻译" onClick={() => void save()}>
          {busy ? '正在保存…' : '保存'}
        </button>
      </>}
      {message === null ? null : <p role="status" className="settings-message">{message}</p>}
      {error === null ? null : <p role="alert" className="settings-message">{error}</p>}
    </section>
  );
}
