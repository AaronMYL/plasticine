// 资料库：笔记、空间、书、文件放在一起管的那一层。对外是批量操作（移动、删除、恢复、永久删除）和给线用的资料库工具。
export { runLibraryBatch, trashItems } from './batch.ts';
export type { BatchCommand, LibraryServices } from './batch.ts';
export { libraryTools } from './tools.ts';
