import { NOTE_MAX_CHARS, DEFAULT_NOTE_FOLDER } from '../../../shared/state.ts';
import { NoteSearchParameters, NoteReadParameters, NoteWriteParameters } from '../../../shared/note-tools.ts';
import type { StateService } from '../../state/index.ts';
import { defineTool, type Tool } from './registry.ts';

/** 写入走工具回执的 once 语义；同一 actionId 回放不会再次追加。 */
export function createNoteTools(state: StateService, changed: (id: string) => void): Tool[] {
  const access = (id: string) => {
    const note = state.notes.require(id);
    if (note.private) { throw new Error('这是私密笔记，不会自动送入对话。需要讨论时，请明确复制愿意提供的文字。'); }
    if (note.deletedAt !== null) { throw new Error('这篇笔记在最近删除中，请先恢复。'); }
    return note;
  };
  return [
    defineTool({
      name: 'note_search', label: '找笔记',
      description: '按标题或正文查找笔记。用户要求记到《X》时先找原笔记，避免重复新建。返回ID和版本，正文用note_read。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto',
      roles: ['conversation', 'worker', 'verifier', 'diagnosis'], timeoutMs: 1000,
      parameters: NoteSearchParameters,
      async execute({ q }) {
        const notes = state.notes.list({ q, readable: (note) => !note.private }, { limit: 100 });
        return JSON.stringify(notes.filter((note) => !note.private).map((note) => ({
          id: note.id, title: note.title, folder: note.folder, version: note.version, preview: note.preview,
        })));
      },
    }),
    defineTool({
      name: 'note_read', label: '读笔记全文', description: '读取一篇笔记完整Markdown和版本；追加前先读原文。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto',
      roles: ['conversation', 'worker', 'verifier', 'diagnosis'], timeoutMs: 1000,
      maxResultChars: NOTE_MAX_CHARS + 2000, parameters: NoteReadParameters,
      async execute({ id }) {
        const note = access(id);
        return JSON.stringify({ id, title: note.title, version: note.version, markdown: state.notes.readBody(note) });
      },
    }),
    defineTool({
      name: 'note_append', label: '记到笔记',
      description: '他让记到笔记时用：向已有笔记追加Markdown，必须传id和刚读到的version；确实不存在时省略id、给title新建；'
        + '不替换已有正文。你自己写的报告、整理稿、草稿用 space_write 写成空间，不进笔记。',
      replay: 'once', effect: 'internal', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 2000,
      parameters: NoteWriteParameters,
      async execute(input) {
        let note;
        if (input.id !== undefined) {
          const current = access(input.id);
          if (input.version === undefined) { throw new Error('追加前需要 note_read 返回的 version。'); }
          const before = state.notes.readBody(current);
          note = state.notes.saveAs(current.id, input.version, {
            markdown: `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}\n${input.markdown}`,
          }, 'ai');
        } else {
          if (input.title === undefined) { throw new Error('新建需要标题；请先查找是否已有同名笔记。'); }
          const existing = state.notes.list({ q: input.title, readable: (row) => !row.private }, { limit: 500 })
            .find((row) => row.title === input.title);
          if (existing !== undefined) {
            throw new Error(`已有《${input.title}》（${existing.id}），请先读取再追加，不重复新建。`);
          }
          note = state.notes.create({ markdown: `# ${input.title}\n\n${input.markdown}`,
            folder: input.folder ?? DEFAULT_NOTE_FOLDER, author: 'ai' });
        }
        changed(note.id);
        return JSON.stringify({ id: note.id, title: note.title, version: note.version, author: note.author });
      },
    }),
  ];
}
