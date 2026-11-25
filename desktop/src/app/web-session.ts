import { existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { app, dialog, session, type BaseWindow, type Session, type WebContents } from 'electron';

export const WEB_PARTITION = 'persist:plasticine-web';
const ASKED: ReadonlySet<string> = new Set(['media', 'geolocation', 'notifications', 'clipboard-read']);
const ALWAYS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const LABELS: Readonly<Record<string, string>> = { media: '用摄像头或麦克风', geolocation: '知道你的位置',
  notifications: '给你发通知', 'clipboard-read': '读剪贴板' };

export function uniqueDownload(directory: string, name: string, exists: (path: string) => boolean): string {
  const safe = basename(name).replace(/[\\/:*?"<>|]/g, '_') || '下载';
  const extension = extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  let candidate = join(directory, safe);
  for (let index = 2; exists(candidate); index += 1) {
    candidate = join(directory, `${stem} (${index})${extension}`);
  }
  return candidate;
}

export interface DownloadEntry {
  name: string;
  path: string;
  url: string;
  bytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: string;
}

const DOWNLOADS_KEPT = 50;
const downloads: DownloadEntry[] = [];

export function recentDownloads(): DownloadEntry[] {
  return downloads.map((entry) => ({ ...entry }));
}

function saveDownloads(target: Session): void {
  target.on('will-download', (_event, item) => {
    const path = uniqueDownload(app.getPath('downloads'), item.getFilename(), existsSync);
    item.setSavePath(path);
    const entry: DownloadEntry = { name: basename(path), path, url: item.getURL(), bytes: 0, state: 'progressing',
      startedAt: new Date().toISOString() };
    downloads.unshift(entry);
    downloads.splice(DOWNLOADS_KEPT);
    item.on('updated', () => {
      entry.bytes = item.getReceivedBytes();
    });
    item.once('done', (_done, state) => {
      entry.bytes = item.getReceivedBytes();
      entry.state = state;
    });
  });
}

export function webSession(window: () => BaseWindow | null, userAgent: string,
  hidden: (contents: WebContents) => boolean = () => false): Session {
  const web = session.fromPartition(WEB_PARTITION);
  web.setUserAgent(userAgent);
  saveDownloads(web);
  const decided = new Map<string, boolean>();
  web.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (ALWAYS.has(permission)) {
      callback(true);
      return;
    }
    if (!ASKED.has(permission) || hidden(contents)) {
      callback(false);
      return;
    }
    let origin = '';
    try {
      origin = new URL(details.requestingUrl ?? contents.getURL()).origin;
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
    const key = `${origin} ${permission}`;
    const known = decided.get(key);
    if (known !== undefined) {
      callback(known);
      return;
    }
    const owner = window();
    const options = { type: 'question' as const, buttons: ['不允许', '允许'], defaultId: 0, cancelId: 0,
      message: `${origin.replace(/^https?:\/\//, '')} 想${LABELS[permission] ?? permission}`,
      detail: '这次打开 Plasticine 期间都按你这次选的来。' };
    void (owner === null ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)).then((answer) => {
      decided.set(key, answer.response === 1);
      callback(answer.response === 1);
    });
  });
  return web;
}

export function uiSession(userAgent: string): Session {
  const ui = session.defaultSession;
  ui.setUserAgent(userAgent);
  saveDownloads(ui);
  ui.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']
      .includes(permission));
  });
  return ui;
}
