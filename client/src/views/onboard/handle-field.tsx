// @账号一栏（11-08 设计稿 Create-Account）：框里前面一个 @，输入时停一下（防抖）去问能不能用，框里最右边写
// 「能用 / 被占了 / 格式不对」；下面一行小字是手机和别的电脑打开它的网址；ⓘ 讲 @账号是什么。
// 格式先在本地按共享的 HandleSchema 看，不对就不去问。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { handleHost, normalizeHandle, validHandle } from './handle.ts';

export { normalizeHandle, validHandle };

/** 停打字这么久再去问（问的是中继，别每个字都问一次）。 */
export const HANDLE_CHECK_DELAY_MS = 400;
const HANDLE_TIP = '@账号 是你在 Cyber Hunter 网络里的名字：朋友靠它加你，你在新设备上靠它登录。';

export type HandleCheck =
  | { kind: 'empty' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'taken' | 'invalid' | 'reserved' }
  /** 中继问不到：不挡建账号（服务端以中继为准，注册没成以后在设置里再起）。 */
  | { kind: 'unreachable'; detail: string | null };

/** 这个 @账号挡不挡「创建」：查着、被占、格式不对、留用都挡；空的和问不到不挡。 */
export function handleBlocks(check: HandleCheck): boolean {
  return check.kind === 'checking' || check.kind === 'taken' || check.kind === 'invalid' || check.kind === 'reserved';
}

export function useHandleCheck(handle: string): HandleCheck {
  const api = useApi();
  const [check, setCheck] = useState<HandleCheck>({ kind: 'empty' });
  useEffect(() => {
    if (handle === '') {
      setCheck({ kind: 'empty' });
      return undefined;
    }
    if (!validHandle(handle)) {
      setCheck({ kind: 'invalid' });
      return undefined;
    }
    setCheck({ kind: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.account.handle(handle, controller.signal).then((answer) => {
        if (controller.signal.aborted) return;
        if (answer.available) setCheck({ kind: 'ok' });
        else if (answer.reason === 'unreachable' || answer.reason === null) {
          setCheck({ kind: 'unreachable', detail: null });
        } else setCheck({ kind: answer.reason });
      }, (cause: unknown) => {
        if (!controller.signal.aborted) setCheck({ kind: 'unreachable', detail: errorText(cause) });
      });
    }, HANDLE_CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, handle]);
  return check;
}

const SUFFIX: Record<Exclude<HandleCheck['kind'], 'empty' | 'checking'>, { text: string; tone: 'ok' | 'err' | '' }> = {
  ok: { text: '能用', tone: 'ok' },
  taken: { text: '被占了', tone: 'err' },
  invalid: { text: '格式不对', tone: 'err' },
  reserved: { text: '留用了', tone: 'err' },
  unreachable: { text: '现在查不了', tone: '' },
};

export function HandleField({ id, value, onChange, check, disabled = false }: { id: string; value: string;
  onChange: (value: string) => void; check: HandleCheck; disabled?: boolean }): ReactNode {
  const handle = normalizeHandle(value);
  const suffix = check.kind === 'empty' || check.kind === 'checking' ? null : SUFFIX[check.kind];
  const bad = suffix?.tone === 'err';
  return (
    <div className="ob-field">
      <span className="ob-label">
        <label htmlFor={id}>@账号</label>
        <InfoTip text={HANDLE_TIP} label="「@账号」的说明" side="right" />
      </span>
      <div className="ob-input" data-invalid={bad}>
        <span className="ob-pre" aria-hidden="true">@</span>
        <input id={id} value={value} disabled={disabled} autoComplete="username" autoCapitalize="none"
          spellCheck={false} maxLength={25} aria-invalid={bad || undefined} aria-describedby={`${id}-state ${id}-url`}
          onChange={(event) => onChange(event.target.value.toLowerCase())} />
        <span id={`${id}-state`} className="ob-suffix" data-tone={suffix?.tone ?? ''} role="status">
          {check.kind === 'ok' ? <Icon name="check" size={13} /> : null}
          {suffix?.text ?? ''}
        </span>
      </div>
      {check.kind === 'invalid' ? <p className="ob-error">3–24 位小写字母、数字或下划线</p> : null}
      {handle === '' || check.kind === 'invalid' ? <span id={`${id}-url`} hidden /> : (
        <p id={`${id}-url`} className="ob-note">手机和别的电脑用 {handleHost(handle)} 打开</p>
      )}
    </div>
  );
}
