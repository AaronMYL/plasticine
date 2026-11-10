import { createHash } from 'node:crypto';
import { Type, type TSchema } from 'typebox';
import { LibraryBatchParameters, LibraryListParameters, LibraryObjectParameters, NoteCreateParameters,
  NoteMoveParameters, NoteUpdateParameters } from '../../shared/library-tools.ts';
import { DEFAULT_NOTE_FOLDER } from '../../shared/state.ts';
import { checkedArgs, type KernelTool, type ToolArgs } from '../lines/index.ts';
import { allPages } from '../state/index.ts';
import { runLibraryBatch, trashItems, type LibraryServices } from './index.ts';

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

export function libraryTools(services: LibraryServices, changed: (id: string) => void = () => undefined): KernelTool[] {
  const { state, workspace } = services;
  function tool<T extends TSchema>(name: string, label: string, description: string, parameters: T,
    run: (args: ReturnType<typeof checkedArgs<T>>, callKey: string) => unknown,
    hardLine: KernelTool['hardLine'] = () => null): KernelTool {
    return { name, say: () => label, hardLine,
      create: (scope) => ({ name, label, description, parameters,
        async execute(callId, input) {
          return json(run(checkedArgs(parameters, input, name), `${scope.lineId}:${callId}`));
        } }) };
  }
  const access = (id: string) => {
    const note = state.notes.require(id);
    if (note.private) throw new Error('这是私密笔记，请在笔记页面操作。');
    return note;
  };
  const batch = (args: ReturnType<typeof checkedArgs<typeof LibraryBatchParameters>>) => {
    for (const item of args.items) if (item.kind === 'note') access(item.id);
    const result = runLibraryBatch(services, args);
    for (const item of result.results) if (item.ok && item.kind === 'note') changed(item.id);
    return result;
  };
  const tools: KernelTool[] = [
    tool('library_list', '查看资料库', '列出笔记、空间、图书和文件。deleted=true 查看最近删除；文件夹逐层用 path。',
      LibraryListParameters, ({ deleted, path }) => {
        if (deleted) return { items: [...trashItems(services), ...trashItems(services, true)]
          .filter((item) => item.kind !== 'note' || !state.notes.require(item.id).private) };
        return {
          notes: allPages((page) => state.notes.list({ readable: (note) => !note.private }, page))
            .filter((note) => !note.private).map(({ id, title, folder, version }) => ({ id, title, folder, version })),
          spaces: allPages((page) => state.spaces.list({}, page))
            .map(({ id, title, category, folder, version }) => ({ id, title, category, folder, version })),
          books: state.books.live().map(({ id, title, folder, version }) => ({ id, title, folder, version })),
          files: workspace.list(path ?? '').entries,
        };
      }),
    { ...tool('library_batch', '批量整理资料',
      '移动、移入最近删除、还原或永久删除列出的项目。action=purge 会真删正文和文件，必须先列出完整清单。',
      LibraryBatchParameters, batch, (args) => args['action'] === 'purge' ? 'irreversible' : null),
      say: (args) => args['action'] === 'purge' ? `永久删除 ${Array.isArray(args['items']) ? args['items'].length : 0} 项`
        : '批量整理资料',
      consequence: (args) => `永久删除 ${Array.isArray(args['items']) ? args['items'].length : 0} 项及文件夹内的文件，`
        + '正文和文件将被清除，只留删除记录，无法还原。', approveLabel: () => '永久删除' },
    tool('note_create', '新建笔记', '按用户给的文字新建笔记。Plasticine 自己撰写的报告、整理稿请用 space_write。',
      NoteCreateParameters, (args, key) => {
        const id = `note-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
        const prior = state.notes.get(id);
        if (prior !== undefined && state.notes.readBody(prior) !== args.markdown) {
          throw new Error('这一动作已经使用过，而且笔记有后续修改。请先重新读取。');
        }
        const note = prior ?? state.notes.create({ markdown: args.markdown, folder: args.folder ?? DEFAULT_NOTE_FOLDER,
          author: 'ai' }, { id });
        changed(id);
        return { id, title: note.title, version: note.version, link: `#/notes/${encodeURIComponent(id)}` };
      }),
    tool('note_update', '修改原笔记', '替换原笔记正文，必须先 note_read 并带 version；已有版本会保留。',
      NoteUpdateParameters, ({ id, version, markdown }) => {
        access(id);
        const note = state.notes.saveAs(id, version, { markdown }, 'ai');
        changed(id);
        return { id, title: note.title, version: note.version, link: `#/notes/${encodeURIComponent(id)}` };
      }),
    tool('note_move', '移动笔记', '将笔记移到指定文件夹。', NoteMoveParameters,
      ({ id, folder }) => batch({ action: 'move', destination: folder, items: [{ kind: 'note', id }] })),
  ];
  for (const kind of ['note', 'space'] as const) {
    for (const action of ['trash', 'restore'] as const) {
      const verb = action === 'trash' ? '移入最近删除' : '还原';
      const object = kind === 'note' ? '笔记' : '空间';
      tools.push(tool(`${kind}_${action === 'trash' ? 'delete' : 'restore'}`, `${verb}${object}`,
        `${object}${verb}，保留正文及已有版本。`, LibraryObjectParameters,
        ({ id }) => batch({ action, items: [{ kind, id }] })));
    }
  }
  // 清空仍显式传项目身份；同数量的不同项目不能借用之前确认过的清单。
  const Empty = Type.Object({ items: LibraryBatchParameters.properties.items,
    expectCount: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
  tools.push({ ...tool('library_empty', '清空最近删除', '先 library_list(deleted=true)，传完整项目清单和数量。',
    Empty, ({ items, expectCount }) => {
      const actual = [...trashItems(services), ...trashItems(services, true)]
        .filter((item) => item.kind !== 'note' || !state.notes.require(item.id).private);
      const keys = (list: typeof items) => list.map((item) => `${item.kind}:${item.id}`).sort().join('\n');
      if (actual.length !== expectCount || keys(actual) !== keys(items)) {
        throw new Error('最近删除已变化，请重新查看清单后确认。');
      }
      return batch({ action: 'purge', items });
    }, () => 'irreversible'),
    consequence: (args: ToolArgs) => `永久删除 ${String(args['expectCount'])} 项及文件夹内的文件，正文和文件清除后无法还原。`,
    approveLabel: () => '全部清空' });
  return tools;
}
