// 笔记的导入和导出（11-18，设计稿「导入导出」）：
// - 导入：笔记列表「更多操作」里「导入…」，一次选几个 .md / .txt，进当前文件夹（在「全部」里进「笔记」）；不弹框，
//   底部提示「已导入 n 篇到「文件夹」· 撤销」（撤销 = 这几篇移到最近删除）；没导入的列在列表顶上，写原因。
// - 导出：一篇的「⋯」里「导出」、多选浮条上「导出」：一篇没有图下 .md，其余下 zip（Obsidian 的样子）。

import type { PlasticineApi } from '../../api/client.ts';
import { blobBase64 } from '../../api/base64.ts';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { DEFAULT_NOTE_FOLDER, type SkippedFileView } from '../../api/shared.ts';
import { showResultToast, showToast } from '../../primitives/toast/index.tsx';
import { saveFile } from '../../shell/save-file.ts';

export const NOTE_IMPORT_ACCEPT = '.md,.markdown,.txt,text/markdown,text/plain';

/** 导入；返回没导入的那几个（交给列表顶上显示）。整个没成就在底部说原因，返回 null。 */
export async function importNoteFiles(api: PlasticineApi, files: readonly File[], folder: string | null)
  : Promise<SkippedFileView[] | null> {
  const target = folder ?? DEFAULT_NOTE_FOLDER;
  showToast({ text: `正在导入 ${files.length} 个文件…`, persist: true });
  try {
    const encoded = await Promise.all(files.map(async (file) => ({ name: file.name,
      contentBase64: await blobBase64(file) })));
    const result = await api.notes.importFiles({ requestId: createRequestId(), folder: target, files: encoded });
    const ids = result.imported.map((note) => note.id);
    if (ids.length === 0) {
      showResultToast(`没有导入：${files.length} 个文件都不能导入`, true);
      return result.skipped;
    }
    showToast({ text: `已导入 ${ids.length} 篇到「${target}」`, action: { label: '撤销', icon: 'undo', run: () => {
      void api.notes.batch({ requestId: createRequestId(), action: 'trash',
        items: ids.map((id) => ({ kind: 'note', id })) })
        .then((response) => showResultToast(response.failed === 0 ? '已撤销，导入的笔记移到了最近删除'
          : `有 ${response.failed} 篇没撤销，到列表里手动删`, response.failed > 0),
        (cause: unknown) => showResultToast(`没撤销：${errorText(cause)}`, true));
    } } });
    return result.skipped;
  } catch (cause) {
    showResultToast(`没导入：${errorText(cause)}`, true);
    return null;
  }
}

/** 导出这几篇：存到这台设备上。 */
export async function exportNoteFiles(api: PlasticineApi, ids: readonly string[]): Promise<void> {
  showToast({ text: ids.length === 1 ? '正在导出…' : `正在导出 ${ids.length} 篇…`, persist: true });
  try {
    const file = await api.notes.exportFiles(ids);
    saveFile(file);
    showToast({ text: `已导出：${file.name}` });
  } catch (cause) {
    showResultToast(`没导出：${errorText(cause)}`, true);
  }
}
