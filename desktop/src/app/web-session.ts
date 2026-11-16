// 网页标签和界面各自的 session：网页标签共用一个持久的 partition（网站登录留在这台电脑上，Chromium 用系统钥匙串加密），
// 和界面自己的 Cookie 分开。下载存到「下载」文件夹（同名自动加后缀，和 Swift 版一样）；摄像头、麦克风、位置、通知这几样
// 网站要的时候弹框问他，同一个网站这次打开期间只问一次；别的权限一律不给。

import { existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { app, dialog, session, type BaseWindow, type Session, type WebContents } from 'electron';

export const WEB_PARTITION = 'persist:plasticine-web';
const ASKED: ReadonlySet<string> = new Set(['media', 'geolocation', 'notifications', 'clipboard-read']);
const ALWAYS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const LABELS: Readonly<Record<string, string>> = { media: '用摄像头或麦克风', geolocation: '知道你的位置',
  notifications: '给你发通知', 'clipboard-read': '读剪贴板' };

/** 「下载」文件夹里不和现有文件重名的路径。 */
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

/** 一个下载（11-16 tab_downloads 给 Plasticine 看：网页上点了下载，存哪了、下完没有）。 */
export interface DownloadEntry {
  name: string;
  path: string;
  url: string;
  bytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: string;
}

/** 最近的下载，新的在前；只记这次打开 Plasticine 以来的。 */
const DOWNLOADS_KEPT = 50;
const downloads: DownloadEntry[] = [];

export function recentDownloads(): DownloadEntry[] {
  return downloads.map((entry) => ({ ...entry }));
}

function saveDownloads(target: Session): void {
  target.on('will-download', (_event, item) => {
    // 设好存哪就不弹「存储为」：后台标签下载时不把框弹到他眼前。
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

/**
 * hidden：这个页面现在没给他看（后台标签）。11-16 线上：后台标签里网站要权限会把系统对话框弹到他眼前；
 * 现在后台的一律先不给（他把标签切出来、网站再要时照常问）。
 */
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

/** 界面自己的 session（默认的那个）：下载照样存「下载」，界面要的通知、麦克风（语音输入）、剪贴板都给。 */
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
