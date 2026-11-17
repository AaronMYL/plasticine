// 迁移带哪些东西（11-16 弹框定：全部；只要数据的不带密钥、登录、设备和地址）。按名单带，不整个目录拷：
// 状态目录里还有备份、日志、可以再下载的组件和多年攒下的旧文件，名单之外的都不动。
// 迁移自己的东西放在状态目录的 migration/ 下：exports/（导出的文件）、imports/<编号>/（上传的文件和解开的暂存）、
// before/<编号>/（导入前留的一份）、pending.json（重启时要做的事）、result.json（刚做完的一次）。

import { isAbsolute, normalize, sep } from 'node:path';
import type { MigrationMode } from '../../../shared/api/migration.ts';

export const DATABASE_ITEM = 'plasticine.sqlite';
/** 库旁边的 WAL 和共享内存文件：替换、退回时跟着库一起挪。 */
export const DATABASE_SIDE_FILES = ['plasticine.sqlite-wal', 'plasticine.sqlite-shm'] as const;
export const SUMMARY_ITEM = 'summary.json';
/** 他的东西：笔记正文和图片、书、文件页、最近删除、对话附件、邮件附件、技能。 */
export const DATA_ITEMS = ['notes', 'books', 'files', 'files-trash', 'attachments', 'mail', 'skills'] as const;
/** 只有全部导出带：邮箱等的登录凭据、隧道证书和钥匙、推送钥匙、邮件图片签名钥匙、SSH 主机。 */
export const MACHINE_ITEMS = [
  'credentials', 'tunnel', 'web-push-vapid.json', 'mail-image.key', 'cloud-tools/ssh-hosts.json',
] as const;

export const MIGRATION_DIRECTORY = 'migration';
export const EXPORTS_DIRECTORY = 'exports';
export const IMPORTS_DIRECTORY = 'imports';
export const BEFORE_DIRECTORY = 'before';
export const PENDING_FILE = 'pending.json';
export const RESULT_FILE = 'result.json';
export const UPLOAD_FILE = 'upload.plasticine';
export const STAGED_DIRECTORY = 'staged';
export const IMPORT_META_FILE = 'import.json';
export const BEFORE_META_FILE = 'before.json';
export const ADDED_FILE = 'added.json';
/** 服务要重启时退出码（systemd 的 Restart=on-failure、桌面客户端看到退出都会再拉起来）。 */
export const RESTART_EXIT_CODE = 75;

/** 这种导出带哪些（库和摘要另算）。 */
export function itemsFor(mode: MigrationMode): string[] {
  return mode === 'full' ? [...DATA_ITEMS, ...MACHINE_ITEMS] : [...DATA_ITEMS];
}

/** 替换时要换掉的（含库和它旁边的两个文件）。 */
export function replacedItems(mode: MigrationMode): string[] {
  return [DATABASE_ITEM, ...DATABASE_SIDE_FILES, ...itemsFor(mode)];
}

/**
 * 文件里一条记录的路径能不能写进暂存：相对、不往上走、落在这种导出该带的东西里。记录路径一律用 /。
 */
export function allowedEntry(path: string, mode: MigrationMode): boolean {
  if (path === '' || path.includes('\\') || path.includes('\0') || isAbsolute(path) || path.startsWith('/')) {
    return false;
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return false;
  }
  if (normalize(path).split(sep).join('/') !== path) {
    return false;
  }
  if (path === DATABASE_ITEM || path === SUMMARY_ITEM) {
    return true;
  }
  return itemsFor(mode).some((item) => path === item || path.startsWith(`${item}/`));
}
