// 设置 · 通用 · 通知「发一条测试通知」（第13批，设计稿 Notify）：桌面客户端自己弹一条、等系统回话；网页让服务端给这台
// 设备推一条。没弹出来就说原因，桌面客户端再给「打开系统设置」（11-14 Aaron 的 Mac 就是系统设置里 Plasticine 关着）。

import { useState, type ReactNode } from 'react';
import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import { desktopShell } from './desktop-shell.ts';

const DesktopResultSchema = Type.Object({ shown: Type.Boolean(), error: Type.Union([Type.String(), Type.Null()]) });

type TestState = { kind: 'idle' | 'sending' | 'sent' } | { kind: 'failed'; reason: string };

export function NotifyTest(): ReactNode {
  const api = useApi();
  const shell = desktopShell();
  const [state, setState] = useState<TestState>({ kind: 'idle' });
  const send = async (): Promise<void> => {
    setState({ kind: 'sending' });
    try {
      if (shell?.notifications.test !== undefined) {
        const result: unknown = await shell.notifications.test();
        if (!Value.Check(DesktopResultSchema, result)) throw new Error('桌面客户端回的结果形状不对');
        setState(result.shown ? { kind: 'sent' } : { kind: 'failed', reason: result.error ?? '系统没弹出来。' });
        return;
      }
      const result = await api.push.test();
      setState(result.sent > 0 && result.error === null ? { kind: 'sent' }
        : { kind: 'failed', reason: result.error ?? '推送服务没收下。' });
    } catch (cause) {
      setState({ kind: 'failed', reason: errorText(cause) });
    }
  };
  return (
    <div className="settings-notify-test">
      <div className="settings-notify-row">
        <span className="settings-notify-label">发一条测试通知</span>
        {state.kind === 'sent' ? <span className="settings-notify-sent" role="status">发出去了</span> : null}
        <button type="button" className="chip-button" disabled={state.kind === 'sending'}
          onClick={() => void send()}>
          <Icon name="bell" size={14} />{state.kind === 'sending' ? '正在发' : '发一条'}
        </button>
      </div>
      {state.kind === 'failed' ? (
        <div className="settings-notify-fail" role="alert">
          <p><b>没弹出来。</b>{state.reason}</p>
          {shell?.notifications.openSettings === undefined ? null : (
            <button type="button" className="chip-button" onClick={() => shell.notifications.openSettings?.()}>
              打开系统设置
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
