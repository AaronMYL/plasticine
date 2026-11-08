// 网页标签和界面各自的 session：网页标签共用一个持久的 partition（网站登录留在这台电脑上，Chromium 用系统钥匙串加密），
// 和界面自己的 Cookie 分开。下载存到「下载」文件夹（同名自动加后缀，和 Swift 版一样）；摄像头、麦克风、位置、通知这几样
// 网站要的时候弹框问他，同一个网站这次打开期间只问一次；别的权限一律不给。

import { existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { app, dialog, session, type BaseWindow, type Session } from 'electron';

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

function saveDownloads(target: Session): void {
  target.on('will-download', (_event, item) => {
    item.setSavePath(uniqueDownload(app.getPath('downloads'), item.getFilename(), existsSync));
  });
}

export function webSession(window: () => BaseWindow | null, userAgent: string): Session {
  const web = session.fromPartition(WEB_PARTITION);
  web.setUserAgent(userAgent);
  saveDownloads(web);
  const decided = new Map<string, boolean>();
  web.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (ALWAYS.has(permission)) {
      callback(true);
      return;
    }
    if (!ASKED.has(permission)) {
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
