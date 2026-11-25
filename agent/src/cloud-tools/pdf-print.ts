import { CDP_ENDPOINT, CdpConnection } from './cdp-connection.ts';
import { CdpBrowserContextSchema, CdpDataSchema, CdpFrameTreeSchema, CdpNumberSchema, CdpReadSchema, CdpSessionSchema,
  CdpStreamSchema, CdpTargetSchema, cdpValue } from './cdp-protocol.ts';
import { CloudToolError } from './errors.ts';

export const PRINT_PAGE_URL = 'about:blank#plasticine-print';
export const PRINT_HTML_MAX_CHARS = 40 * 1024 * 1024;
const PDF_MAX_BYTES = 64 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 5_000;
const READY = `Promise.all([document.fonts.ready,
  ...Array.from(document.images, (image) => image.decode().catch(() => null))]).then(() => true)`;
export const SHOT_WIDTH = 1200;
const SHOT_MAX_HEIGHT = 16_000;
const SETTLE_MS = 400;

export type RenderFormat = 'pdf' | 'png';

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

async function shotIn(connection: CdpConnection, sessionId: string, signal: AbortSignal): Promise<Buffer> {
  const metrics = { width: SHOT_WIDTH, height: 900, deviceScaleFactor: 1, mobile: false };
  await connection.send('Emulation.setDeviceMetricsOverride', metrics, signal, sessionId);
  const measured = cdpValue(CdpNumberSchema, await connection.send('Runtime.evaluate', {
    expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true }, signal, sessionId));
  const height = Math.max(1, Math.min(SHOT_MAX_HEIGHT, measured.result.value));
  const scale = height * 2 <= SHOT_MAX_HEIGHT ? 2 : 1;
  await connection.send('Emulation.setDeviceMetricsOverride', { ...metrics, height, deviceScaleFactor: scale }, signal,
    sessionId);
  const shot = cdpValue(CdpDataSchema, await connection.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false }, signal, sessionId));
  return Buffer.from(shot.data, 'base64');
}

async function renderIn(connection: CdpConnection, sessionId: string, html: string, format: RenderFormat,
  signal: AbortSignal): Promise<Buffer> {
  const tree = cdpValue(CdpFrameTreeSchema, await connection.send('Page.getFrameTree', {}, signal, sessionId));
  await connection.send('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html }, signal, sessionId);
  await connection.send('Runtime.evaluate', { expression: READY, awaitPromise: true, returnByValue: true }, signal,
    sessionId);
  if (format === 'png') {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    return shotIn(connection, sessionId, signal);
  }
  const printed = cdpValue(CdpStreamSchema, await connection.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    transferMode: 'ReturnAsStream',
  }, signal, sessionId));
  return readStream(connection, sessionId, printed.stream, signal);
}

export async function printPdf(html: string, signal: AbortSignal, endpoint = CDP_ENDPOINT): Promise<Buffer> {
  return renderPage(html, 'pdf', signal, endpoint);
}

export async function renderPage(html: string, format: RenderFormat, signal: AbortSignal, endpoint = CDP_ENDPOINT)
  : Promise<Buffer> {
  if (html.length > PRINT_HTML_MAX_CHARS) {
    throw new CloudToolError('invalid_input', '内容太大了（超过 40 MB），拆成几份再导出。');
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
    return await renderIn(connection, session.sessionId, html, format, signal);
  } finally {
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
