// 资料库导入（11-18）：资料库「更多操作」里「导入…」，一次选几个 Markdown、TXT、Word、网页文件，每个成一个报告。
// 不弹框：底部「已导入 n 篇到「报告」· 撤销」（撤销 = 这几篇移到最近删除）；没导入的列在页面顶上，写原因。

import type { PlasticineApi } from '../../api/client.ts';
import { blobBase64 } from '../../api/base64.ts';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SkippedFileView } from '../../api/shared.ts';
import { showResultToast, showToast } from '../../primitives/toast/index.tsx';

export const SPACE_IMPORT_ACCEPT = '.md,.markdown,.txt,.docx,.html,.htm,text/markdown,text/plain,text/html,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function importSpaceFiles(api: PlasticineApi, files: readonly File[], changed: () => void)
  : Promise<SkippedFileView[] | null> {
  showToast({ text: `正在导入 ${files.length} 个文件…`, persist: true });
  try {
    const encoded = await Promise.all(files.map(async (file) => ({ name: file.name,
      contentBase64: await blobBase64(file) })));
    const result = await api.spaces.importFiles({ requestId: createRequestId(), files: encoded });
    changed();
    const ids = result.imported.map((space) => space.id);
    if (ids.length === 0) {
      showResultToast(`没有导入：${files.length} 个文件都不能导入`, true);
      return result.skipped;
    }
    showToast({ text: `已导入 ${ids.length} 篇到「报告」`, action: { label: '撤销', icon: 'undo', run: () => {
      void api.library.batch({ requestId: createRequestId(), action: 'trash',
        items: ids.map((id) => ({ kind: 'space', id })) })
        .then((response) => {
          changed();
          showResultToast(response.failed === 0 ? '已撤销，导入的空间移到了最近删除'
            : `有 ${response.failed} 篇没撤销，到资料库里手动删`, response.failed > 0);
        }, (cause: unknown) => showResultToast(`没撤销：${errorText(cause)}`, true));
    } } });
    return result.skipped;
  } catch (cause) {
    showResultToast(`没导入：${errorText(cause)}`, true);
    return null;
  }
}
