// 一个写操作（任务命令、作答、先不、问一句）还没了结时，任务条和要你定卡上就地的一行：在路上 / 结果待核实 →
// 「再核实」（同一标识再发，服务端做过就只回结果）/ 没送到 →「重发」「不发了」/ 被拒 → 服务端那句原因 +「知道了」。
// 和消息原语里你的话下面那一行同一个写法（component-recipes「任务反馈与操作按钮」：未知结果给核实路径）。

import type { ReactNode } from 'react';
import './op-line.css';

export type OpStatus = 'running' | 'uncertain' | 'unsent' | 'failed';

export interface OpView {
  key: string;
  label: string;
  status: OpStatus;
  error: string | null;
  /** 待核实过的不让「不发了」：它可能已经生效。 */
  unresolved: boolean;
}

const STATUS_TEXT: Readonly<Record<OpStatus, string>> = {
  running: '发出中',
  uncertain: '结果待核实',
  unsent: '没有送到',
  failed: '没做成',
};

// 旧缓存只保留了错误文字。精确识别已退役的浏览器签名错误，不掩盖会话失效或其他业务的签名验证错误。
const LEGACY_KEY_ERRORS = [
  '这台设备没有签名钥匙，',
  '这台设备还没有登记签名钥匙，',
  '正在准备这台设备的签名钥匙',
  '这个浏览器存不了签名钥匙',
  '签名钥匙还没登记上：',
  '这一步改的是要你确认的内容，请求里没有这台设备的签名',
  '签名时间的格式不对，',
  '这次签名已经过期，',
  '签名和这台设备登记的钥匙对不上，',
  '请用设备签名授权这一次动作。',
  '请在记账卡签名确认。',
  '生效约定要设备签名。',
];

/** 只更新旧钥匙错误的显示；缓存中的正文、请求标识和待核实状态不变。 */
export function operationErrorText(op: Pick<OpView, 'error' | 'status' | 'unresolved'>): string | null {
  if (op.error === null || !LEGACY_KEY_ERRORS.some((prefix) => op.error?.startsWith(prefix))) return op.error;
  if (op.unresolved || op.status === 'uncertain') return '尚未取得这次操作的结果，请再核实。';
  return op.status === 'unsent' ? '这次没有执行，请重发。' : '这次没有执行，可以再次确认。';
}

export interface OpLineProps {
  op: OpView;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
}

export function OpLine({ op, onRetry, onDismiss }: OpLineProps): ReactNode {
  const failed = op.status === 'failed';
  const error = operationErrorText(op);
  return (
    <div className="op-line" role={failed ? 'alert' : 'status'} data-status={op.status}>
      <span className={failed ? 'op-line-state is-error' : 'op-line-state'}>
        「{op.label}」{STATUS_TEXT[op.status]}
      </span>
      {error === null ? null : (
        <span className={failed ? 'op-line-reason is-error' : 'op-line-reason'}>{error}</span>
      )}
      {op.status === 'uncertain' ? (
        <button type="button" className="text-button" onClick={() => onRetry(op.key)}>
          再核实
        </button>
      ) : null}
      {op.status === 'unsent' ? (
        <button type="button" className="text-button" onClick={() => onRetry(op.key)}>
          重发
        </button>
      ) : null}
      {op.status === 'unsent' && !op.unresolved ? (
        <button type="button" className="text-button text-button-quiet" onClick={() => onDismiss(op.key)}>
          不发了
        </button>
      ) : null}
      {failed ? (
        <button type="button" className="text-button text-button-quiet" onClick={() => onDismiss(op.key)}>
          知道了
        </button>
      ) : null}
    </div>
  );
}

export function OpLines(props: { ops: readonly OpView[] } & Omit<OpLineProps, 'op'>): ReactNode {
  if (props.ops.length === 0) {
    return null;
  }
  return (
    <div className="op-lines">
      {props.ops.map((op) => (
        <OpLine key={op.key} op={op} onRetry={props.onRetry} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}
