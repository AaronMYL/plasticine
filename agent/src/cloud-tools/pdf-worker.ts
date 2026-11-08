// 在独立线程解析不可信 PDF；不执行脚本、不加载外部资源。父线程有取消、超时及内存上限。
import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CONVERSATION_ATTACHMENT_TEXT_LIMIT } from '../../shared/attachments.ts';

const loading = getDocument({
  data: new Uint8Array(workerData as Uint8Array),
  verbosity: 0,
  useWorkerFetch: false,
  disableFontFace: true,
  disableAutoFetch: true,
  stopAtErrors: true,
});
try {
  const document = await loading.promise;
  let text = '';
  let truncated = false;
  const pageLimit = Math.min(document.numPages, 200);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    text += content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('');
    page.cleanup();
    if (text.length > CONVERSATION_ATTACHMENT_TEXT_LIMIT) {
      truncated = true;
      break;
    }
  }
  truncated ||= document.numPages > pageLimit;
  if (text.trim() === '') {
    parentPort?.postMessage({ ok: false });
  } else {
    parentPort?.postMessage({ ok: true, text: text.slice(0, CONVERSATION_ATTACHMENT_TEXT_LIMIT), truncated });
  }
} catch {
  parentPort?.postMessage({ ok: false });
} finally {
  await loading.destroy();
}
