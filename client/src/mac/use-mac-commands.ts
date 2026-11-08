import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Value } from 'typebox/value';
import { useApi } from '../api/context.tsx';
import { createRequestId } from '../api/request-id.ts';
import { MacAttachFilesSchema, type MacAttachedFile } from '../api/shared.ts';
import type { Route } from '../shell/routes.ts';
import { useClientState } from '../state/context.tsx';
import { CREATE_NOTE_OP } from '../state/note-ops.ts';
import './bridge.ts';

export function useMacCommands(expandComposer: () => void, navigate: (route: Route) => void, view: string): void {
  const api = useApi();
  const state = useClientState();
  const actions = useRef({ expandComposer, navigate });
  actions.current = { expandComposer, navigate };
  const [focus, setFocus] = useState(0);
  const focused = useRef(0);
  useLayoutEffect(() => {
    const input = document.querySelector<HTMLTextAreaElement>('.conv-input');
    if (focus > focused.current && input !== null) {
      input.focus();
      focused.current = focus;
    }
  }, [focus, view]);
  useEffect(() => {
    let active = true;
    const focusComposer = (): void => {
      actions.current.expandComposer();
      setFocus((value) => value + 1);
    };
    const attach = async (input: MacAttachedFile[]): Promise<void> => {
      focusComposer();
      try {
        if (!Value.Check(MacAttachFilesSchema, input)) { throw new Error('Mac 文件格式不对'); }
        const files = input.map((file) => {
          const binary = atob(file.base64);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          return new File([bytes], file.name, { type: file.type });
        });
        await state.attachments.add(files, api.attachments);
      } catch {
        state.attachments.error.set('Mac 文件没能加入，请重新拖入文件。');
      }
    };
    const newNote = async (): Promise<void> => {
      actions.current.navigate({ view: 'notes', noteId: null });
      if (state.noteOps.store.get().get(CREATE_NOTE_OP)?.status === 'running') { return; }
      const requestId = state.noteOps.begin(CREATE_NOTE_OP, createRequestId);
      try {
        const note = await api.notes.create({ markdown: '', requestId });
        state.noteOps.succeed(CREATE_NOTE_OP);
        if (active) { actions.current.navigate({ view: 'notes', noteId: note.id }); }
      } catch (error) { state.noteOps.fail(CREATE_NOTE_OP, error); }
    };
    window.__plasticineAttachFiles = attach;
    window.__plasticineFocusComposer = focusComposer;
    window.__plasticineNewNote = newNote;
    return () => {
      active = false;
      if (window.__plasticineAttachFiles === attach) { delete window.__plasticineAttachFiles; }
      if (window.__plasticineFocusComposer === focusComposer) { delete window.__plasticineFocusComposer; }
      if (window.__plasticineNewNote === newNote) { delete window.__plasticineNewNote; }
    };
  }, [api, state]);
}
