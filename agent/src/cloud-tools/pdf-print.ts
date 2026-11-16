// 一页 HTML 打印成 PDF（11-16 生成 PDF、转 PDF 用）：借云端共享浏览器，开一个隔离的浏览器上下文和一个后台标签，
// 把 HTML 直接放进页面（不经网址、不去网上拿东西），等字体和图片好了用 Page.printToPDF 按流取回，最后关掉标签和上下文。
// 这个标签的地址带固定的记号，云端浏览器的标签列表不列它（cdp-browser.ts 按记号滤掉）。

import { CDP_ENDPOINT, CdpConnection } from './cdp-connection.ts';
import { CdpBrowserContextSchema, CdpFrameTreeSchema, CdpReadSchema, CdpSessionSchema, CdpStreamSchema,
  CdpTargetSchema, cdpValue } from './cdp-protocol.ts';
import { CloudToolError } from './errors.ts';

/** 打印用的标签的地址：标签列表按这个前缀滤掉。 */
export const PRINT_PAGE_URL = 'about:blank#plasticine-print';
/** 放进页面的 HTML 最多这么大（图片按 data: 地址算在里面）。 */
export const PRINT_HTML_MAX_CHARS = 40 * 1024 * 1024;
/** 生成的 PDF 最多这么大。 */
const PDF_MAX_BYTES = 64 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;
/** 收尾（关标签、关上下文）最多等这么久。 */
const CLEANUP_TIMEOUT_MS = 5_000;
const READY = `Promise.all([document.fonts.ready,
  ...Array.from(document.images, (image) => image.decode().catch(() => null))]).then(() => true)`;

/** 流的句柄属于打印它的那个标签：读、关都要带上标签的会话。 */
async function readStream(connection: CdpConnection, sessionId: string, handle: string, signal: AbortSignal):
  Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for (;;) {
    const read = await connection.send('IO.read', { handle, size: READ_CHUNK }, signal, sessionId);
    const chunk = cdpValue(CdpReadSchema, read);
    const data = Buffer.from(chunk.data, chunk.base64Encoded === true ? 'base64' : 'binary');
    size += data.length;
    if (size > PDF_MAX_BYTES) {
      throw new CloudToolError('invalid_input', 'PDF 太大了（超过 64 MB），拆成几份再生成。');
    }
    parts.push(data);
    if (chunk.eof) {
      break;
    }
  }
  await connection.send('IO.close', { handle }, signal, sessionId);
  return Buffer.concat(parts);
}

async function printIn(connection: CdpConnection, sessionId: string, html: string, signal: AbortSignal):
  Promise<Buffer> {
  const tree = cdpValue(CdpFrameTreeSchema, await connection.send('Page.getFrameTree', {}, signal, sessionId));
  await connection.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html }, signal, sessionId);
  await connection.send('Runtime.evaluate', { expression: READY, awaitPromise: true, returnByValue: true }, signal,
    sessionId);
  const printed = cdpValue(CdpStreamSchema, await connection.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    transferMode: 'ReturnAsStream',
  }, signal, sessionId));
  return readStream(connection, sessionId, printed.stream, signal);
}

/** HTML → PDF 的字节。浏览器没起来时抛「浏览器还没起来」。 */
export async function printPdf(html: string, signal: AbortSignal, endpoint = CDP_ENDPOINT): Promise<Buffer> {
  if (html.length > PRINT_HTML_MAX_CHARS) {
    throw new CloudToolError('invalid_input', '内容太大了（超过 40 MB），拆成几份再生成 PDF。');
  }
  const connection = await CdpConnection.connect(endpoint, signal, () => undefined);
  let context: string | null = null;
  let target: string | null = null;
  try {
    context = cdpValue(CdpBrowserContextSchema, await connection.send('Target.createBrowserContext',
      { disposeOnDetach: true }, signal)).browserContextId;
    target = cdpValue(CdpTargetSchema, await connection.send('Target.createTarget',
      { url: PRINT_PAGE_URL, browserContextId: context, background: true }, signal)).targetId;
    const session = cdpValue(CdpSessionSchema, await connection.send('Target.attachToTarget',
      { targetId: target, flatten: true }, signal));
    return await printIn(connection, session.sessionId, html, signal);
  } finally {
    // 收尾不跟着调用方取消：取消了也要把标签和上下文关掉。关不掉不影响结果：上下文建的时候说了连接一断就收掉。
    const cleanup = AbortSignal.timeout(CLEANUP_TIMEOUT_MS);
    if (target !== null) {
      await connection.send('Target.closeTarget', { targetId: target }, cleanup).catch(() => undefined);
    }
    if (context !== null) {
      await connection.send('Target.disposeBrowserContext', { browserContextId: context }, cleanup)
        .catch(() => undefined);
    }
    connection.close();
  }
}
