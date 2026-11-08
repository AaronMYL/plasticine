import { expect, it } from 'vitest';
import { uncertainError } from '../../src/api/errors.ts';
import { refreshBlockers } from '../../src/shell/refresh-notes.ts';
import { hasUnsavedWork } from '../../src/shell/unsaved-guard.ts';
import { ACTION_OPS_STORAGE_KEY } from '../../src/state/action-ops.ts';
import { createClientState } from '../../src/state/context.tsx';
import { SIGNED_OPS_STORAGE_KEY } from '../../src/state/signed-ops.ts';
import { memoryStorage } from '../helpers.tsx';

it.each(['action', 'signed'] as const)('旧 %s 解锁记录保留，刷新不再把它算作未完成写入', (kind) => {
  const storage = memoryStorage();
  const state = createClientState({ storage });
  const key = 'note:private:unlock';
  if (kind === 'action') {
    state.actionOps.begin(key, '解锁笔记', '私密笔记',
      (requestId) => ({ kind: 'note_unlock', noteId: 'private', body: { requestId } }), () => 'req_old_unlock');
    state.actionOps.fail(key, uncertainError('解锁笔记'));
  } else {
    state.signedOps.begin(key, '解锁笔记', '私密笔记', { kind: 'note_unlock', noteId: 'private' },
      (requestId) => ({ requestId }));
    state.signedOps.fail(key, uncertainError('解锁笔记'));
  }
  const storageKey = kind === 'action' ? ACTION_OPS_STORAGE_KEY : SIGNED_OPS_STORAGE_KEY;
  const saved = storage.getItem(storageKey);
  const reopened = createClientState({ storage });
  expect(hasUnsavedWork(reopened)).toBe(false);
  expect(refreshBlockers(reopened)).toEqual([]);
  const op = kind === 'action' ? reopened.actionOps.get(key) : reopened.signedOps.get(key);
  expect(op).toMatchObject({ status: 'uncertain', unresolved: true });
  expect(storage.getItem(storageKey)).toBe(saved);
  reopened.actionOps.begin('note:private:save', '保存笔记', '私密笔记',
    (requestId) => ({ kind: 'note_save', noteId: 'private', body: { requestId, version: 1, markdown: '草稿' } }),
    () => 'req_real_save');
  expect(hasUnsavedWork(reopened)).toBe(true);
  expect(refreshBlockers(reopened)).toContain('还有写入操作待核实');
});
