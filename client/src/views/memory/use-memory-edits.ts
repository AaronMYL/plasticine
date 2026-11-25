import { useCallback } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { MemoryDocLine, MemoryLineSection } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';

export interface MemoryEdits {
  add(docId: string, text: string, section?: MemoryLineSection): Promise<string | null>;
  edit(docId: string, line: MemoryDocLine, text: string): Promise<string | null>;
  remove(docId: string, line: MemoryDocLine): Promise<string | null>;
  move(docId: string, line: MemoryDocLine, toDocId: string): Promise<string | null>;
  moveSection(docId: string, line: MemoryDocLine, section: MemoryLineSection): Promise<string | null>;
  withdraw(docId: string, line: MemoryDocLine): Promise<string | null>;
}

export function useMemoryEdits(): MemoryEdits {
  const api = useApi();
  const live = useLive();
  const run = useCallback(async (docs: readonly string[], send: () => Promise<void>): Promise<string | null> => {
    try {
      await send();
      await Promise.all([live.memoryTopics.open(), ...docs.map((id) => live.memoryTopics.openDoc(id))]);
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }, [live]);
  return {
    add: (docId, text, section) => run([docId], () => api.memoryTopics.addLine(docId,
      { requestId: createRequestId(), text, ...(section === undefined ? {} : { section }) })),
    edit: (docId, line, text) => run([docId], () => api.memoryTopics.editLine(docId, line.id,
      { requestId: createRequestId(), version: line.version, text })),
    remove: (docId, line) => run([docId], () => api.memoryTopics.retireLine(docId, line.id,
      { requestId: createRequestId(), version: line.version })),
    move: (docId, line, toDocId) => run([docId, toDocId], () => api.memoryTopics.moveLine(docId, line.id,
      { requestId: createRequestId(), version: line.version, toDocId })),
    moveSection: (docId, line, section) => run([docId], () => api.memoryTopics.moveLine(docId, line.id,
      { requestId: createRequestId(), version: line.version, toDocId: docId, section })),
    withdraw: (docId, line) => run([docId], () => api.memoryTopics.retireLine(docId, line.id,
      { requestId: createRequestId(), version: line.version, mode: 'withdraw' })),
  };
}
