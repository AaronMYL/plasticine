import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError, uncertainError } from '../../src/api/errors.ts';
import { OpLine } from '../../src/primitives/task-row/op-line.tsx';
import { SignedOps, SIGNED_OPS_STORAGE_KEY } from '../../src/state/signed-ops.ts';
import { memoryStorage } from '../helpers.tsx';

it.each([false, true])('老缓存缺钥匙错误刷新后只改显示，保留原请求与待核实状态：%s', (unresolved) => {
  const storage = memoryStorage();
  const ops = new SignedOps(storage);
  const original = ops.begin('agreement:old:confirm', '确认约定', '旧约定',
    { kind: 'agreement_confirm', agreementId: 'old' },
    (requestId) => ({ requestId, version: 1, decision: 'confirm' }));
  if (unresolved) ops.fail(original.key, uncertainError('确认约定'));
  ops.fail(original.key, new ApiError({ kind: 'invalid', code: 'device_key_missing',
    message: '这台设备没有签名钥匙，重新配对后才能授权设备动作、恢复备份、解锁私密笔记。',
    next: '在服务器上生成配对码，重新配对这台设备。' }));
  const stored = storage.data.get(SIGNED_OPS_STORAGE_KEY);
  const reloaded = new SignedOps(storage);
  const op = reloaded.get(original.key)!;
  const before = structuredClone(op);
  const retry = vi.fn();
  render(<OpLine op={op} onRetry={retry} onDismiss={vi.fn()} />);
  expect(screen.queryByText(/签名钥匙|重新配对后才能/)).toBeNull();
  const action = unresolved ? '再核实' : '重发';
  expect(screen.getByText(unresolved ? '尚未取得这次操作的结果，请再核实。' : '这次没有执行，请重发。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(retry).toHaveBeenCalledWith(original.key);
  expect(reloaded.get(original.key)).toEqual(before);
  expect(op).toMatchObject({ requestId: original.requestId, bodyText: original.bodyText, unresolved,
    status: unresolved ? 'uncertain' : 'unsent' });
  expect(storage.data.get(SIGNED_OPS_STORAGE_KEY)).toBe(stored);
});

it.each(['会话失效，这次没有执行。重新配对后点「重发」。', '应用签名验证失败，请核对安装来源。'])
  ('真实会话失效或其他业务错误仍原样显示：%s', (error) => {
    render(<OpLine op={{ key: 'op', label: '执行', error, status: 'unsent', unresolved: false }}
      onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(error)).toBeTruthy();
  });
