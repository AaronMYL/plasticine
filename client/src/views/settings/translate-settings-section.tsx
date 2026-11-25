import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import {
  TRANSLATE_TARGET_LABELS, TRANSLATE_TARGETS,
  type TranslateSettingsView, type TranslateTarget,
} from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { TRANSLATE_SETTINGS_CHANGED } from '../../shell/web-translate-context.tsx';
import { SectionHead } from './section-head.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';
import { SettingRow, SettingSelect, SettingSwitch, type SelectOption } from './setting-row.tsx';

const TRANSLATE_NOTE = '在电脑客户端的网页标签里点地址栏右边的「文A」翻译；只发段落文字，同一段再看不再花额度。\n'
  + '用词表开着时，你的用词按记忆里的词表译。\n'
  + '保存后下一批译文生效，已经插在页面上的译文不变。';

const TARGETS: readonly SelectOption<TranslateTarget>[] = TRANSLATE_TARGETS.map((value) => ({ value,
  label: TRANSLATE_TARGET_LABELS[value] }));
const DISPLAYS: readonly SelectOption<TranslateSettingsView['display']>[] = [
  { value: 'bilingual', label: '双语对照' }, { value: 'translation', label: '只看译文' },
];

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
  const changed = draft !== null && settings !== null && !same(draft, settings);
  useSettingsDraft(changed, () => {
    setDraft(null);
    setMessage(null);
  });
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
        <IconButton icon="refresh" label="再读一次网页翻译设置" disabled={busy} onClick={() => {
          setDraft(null);
          setError(null);
          setMessage(null);
          setRevision((value) => value + 1);
        }} />
      </SectionHead>
      {current === null ? null : <>
        <SettingSelect name="翻译成" value={current.target} options={TARGETS} disabled={busy}
          onChange={(target) => editSettings({ target })} />
        <SettingSelect name="显示" value={current.display} options={DISPLAYS} disabled={busy}
          onChange={(display) => editSettings({ display })} />
        <SettingSwitch name="用词表" checked={current.glossary} disabled={busy}
          onChange={(glossary) => editSettings({ glossary })} />
        {current.alwaysSites.length === 0 ? null : <>
          <SettingRow name="总是翻译" sub={`${current.alwaysSites.length} 个网站`} />
          <ul className="set-sub translate-sites" aria-label="总是翻译">
            {current.alwaysSites.map((site) => (
              <SettingRow key={site} as="li" name={site}>
                <IconButton icon="close" size={14} label={`不再总是翻译 ${site}`} disabled={busy}
                  onClick={() => editSettings({
                    alwaysSites: current.alwaysSites.filter((entry) => entry !== site) })} />
              </SettingRow>
            ))}
          </ul>
        </>}
        {changed ? (
          <div className="set-actions">
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => {
                setDraft(null);
                setMessage(null);
              }}>取消</button>
            <button type="button" className="primary-button" disabled={busy} aria-label="保存网页翻译"
              onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</button>
          </div>
        ) : null}
      </>}
      {message === null ? null : <p role="status" className="settings-message">{message}</p>}
      {error === null ? null : <p role="alert" className="settings-message">{error}</p>}
    </section>
  );
}
